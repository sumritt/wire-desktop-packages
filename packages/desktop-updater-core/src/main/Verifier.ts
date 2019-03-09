/*
 * Wire
 * Copyright (C) 2018 Wire Swiss GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see http://www.gnu.org/licenses/.
 *
 */

import * as Long from 'long';
import {DateTime} from 'luxon';

import {Config} from './Config';
import {Environment} from './Environment';
import {Updater} from './Updater';
import {Utils} from './Utils';

import {NodeVMOptions} from 'vm2';
import {Sandbox} from './Sandbox';

import {BaseError} from 'make-error-cause';

export class VerifyError extends BaseError {}
export class VerifyExpirationError extends BaseError {}
export class VerifyMismatchEnvironment extends BaseError {}
export class BlacklistedVersionError extends BaseError {}
export class IntegrityError extends BaseError {}

export class Verifier {
  private static readonly sandboxOptions: NodeVMOptions = {
    require: {
      context: 'host',
      external: ['sodium-native'],
      root: '../',
    },
  };

  private static readonly MAX_EXPIRES_TIME: number = Config.Verifier.MAX_EXPIRES_TIME;

  public static readonly OUTDATED = {WRAPPER: '0', WEBAPP: '1'};

  public static async verifyManifest(
    manifest: Updater.Manifest,
    webappVersion: string,
    currentWebappEnv: string,
    currentWrapperVersion: string
  ): Promise<void> {
    const {
      changelog,
      fileChecksum,
      fileContentLength,
      specVersion,
      minimumClientVersion,
      author,
    }: Updater.Manifest = manifest;

    // Check if specVersion is equal to ours
    if (specVersion !== Config.Updater.SPEC_VERSION) {
      throw new VerifyError('Current specs number is not supported');
    }

    // PART 1: Check dates

    const currentTime = DateTime.utc();
    const expiresOn = DateTime.fromISO(manifest.expiresOn, {zone: 'utc'});
    const releaseDate = DateTime.fromISO(manifest.releaseDate, {zone: 'utc'});

    // Ensure the expiration date and the release date are proper dates
    if (!expiresOn.isValid || !releaseDate.isValid || !currentTime.isValid) {
      throw new VerifyError('Expected ISO 8601 dates are not valid');
    }

    // Ensure release date is not inferior to current time
    if (releaseDate > currentTime) {
      throw new VerifyError('This update has not been yet released');
    }

    // Ensure maximal distance in time between release and expiration time is not longer than the limitation
    if (<number>releaseDate.diff(expiresOn, 'milliseconds').toObject().milliseconds > Verifier.MAX_EXPIRES_TIME) {
      throw new VerifyError('This update exceed the enforced validity limitation');
    }

    // Ensure the update is not expired
    if (currentTime > expiresOn) {
      throw new VerifyExpirationError('This update expired and is no longer valid');
    }

    // PART 2: Check wrapper version

    // Ensure wrapper version is valid
    if (!Utils.isValidVersion(minimumClientVersion) || !Utils.isValidVersion(currentWrapperVersion)) {
      throw new VerifyError(
        `Client versions are not valid. Minimum client version is ${minimumClientVersion} and current wrapper version is ${currentWrapperVersion}`
      );
    }

    // PART 3: Check webapp version
    const defaultOutdatedWebappVersion: DateTime = Utils.parseWebappVersion(Config.Updater.FALLBACK_WEB_VERSION)
      .buildDate;
    const currentWebappVersion: DateTime = Utils.parseWebappVersion(webappVersion).buildDate;

    const webappVersionNumber: DateTime = Utils.parseWebappVersion(manifest.webappVersionNumber).buildDate;
    const minimumWebAppVersionNumber: DateTime = Utils.parseWebappVersion(manifest.minimumWebAppVersion).buildDate;

    const webappVersionEnv: string = manifest.targetEnvironment;
    const localEnvironment: string = await Environment.get();
    const isSameEnvironment = localEnvironment === webappVersionEnv;

    // Ensure web versions are valid dates
    if (
      !defaultOutdatedWebappVersion ||
      !currentWebappVersion.isValid ||
      !webappVersionNumber.isValid ||
      !minimumWebAppVersionNumber.isValid
    ) {
      throw new VerifyError('Webapp versions are not valid');
    }

    // Ensure none of the dates are below the default outdated webapp version
    // that is set if no webapp version is available
    if (defaultOutdatedWebappVersion >= webappVersionNumber) {
      throw new VerifyError('This webapp version is too old to be used');
    }
    if (defaultOutdatedWebappVersion >= minimumWebAppVersionNumber) {
      throw new VerifyError('This webapp version have a minimum requirement that is too old to be used');
    }

    // Ensure this version is newer or equal to the one installed
    if (currentWebappVersion > webappVersionNumber && isSameEnvironment === true) {
      throw new VerifyError('The given update is older than ours');
    }

    // Ensure the provided version in the manifest is superior to the minimum app version
    if (minimumWebAppVersionNumber > webappVersionNumber) {
      throw new VerifyError('Minimum version required cannot be satisfacted as latest version is lower');
    }

    // PART 3: Check file-related data

    // Check if checksum is present and is a buffer
    if (Buffer.isBuffer(fileChecksum) === false) {
      throw new VerifyError('File checksum is not a buffer');
    }

    // Check if content length is not more than 100MB (or the maximum allowed settings)
    if (Long.isLong(fileContentLength) === false) {
      throw new VerifyError('File content length is not a long');
    }

    // PART 4: Check other data

    // Check if changelog is indeed a string
    if (typeof changelog !== 'string') {
      throw new VerifyError('Changelog is not a string');
    }

    // Check if there is at least an author
    if (Array.isArray(author) === false || author.length < 1) {
      throw new VerifyError('No author has been specified for this update');
    }

    // Do the blacklist / mismatch checks at the end (otherwise we will skip some checks)

    // Ensure the wrapper is not blacklisted
    if (Utils.compareClientVersion(currentWrapperVersion, minimumClientVersion) === -1) {
      throw new BlacklistedVersionError(Verifier.OUTDATED.WRAPPER);
    }

    // Ensure this update target our environment
    if (isSameEnvironment === false) {
      throw new VerifyMismatchEnvironment('Local environment mismatch remote one');
    }

    // Throw an error if environment mismatch the remote one
    // Note: This check must come before checking if the web app is blacklisted as
    // we're going to reinstall it anyway
    if (currentWebappEnv !== webappVersionEnv) {
      throw new VerifyMismatchEnvironment('This webapp bundle is not intended for this environment');
    }

    // Ensure the webapp is not blacklisted
    if (minimumWebAppVersionNumber > currentWebappVersion) {
      throw new BlacklistedVersionError(Verifier.OUTDATED.WEBAPP);
    }
  }

  public static async ensurePublicKeyIsTrusted(publicKey: Buffer, trustStore: string[], env?: string): Promise<void> {
    if (Buffer.isBuffer(publicKey) === false) {
      throw new IntegrityError(`Public key provided is not a buffer.`);
    }

    const currentEnvironment: string = env || (await Environment.get());

    if (Array.isArray(trustStore) === false) {
      throw new IntegrityError(
        `Trust store does not exist for the environment "${currentEnvironment}" (or is not an array).`
      );
    }
    if (trustStore.length < 1) {
      throw new IntegrityError(`No keys are present in the trust store for the environment "${currentEnvironment}".`);
    }
    if (trustStore.includes(publicKey.toString('hex')) === false) {
      throw new IntegrityError(
        `Public key is not in the trust store for environment "${currentEnvironment}". Public key: ${publicKey.toString(
          'hex'
        )}`
      );
    }
  }

  public static async verifyEnvelopeIntegrity(data: Buffer, signature: Buffer, publicKey: Buffer): Promise<void> {
    const isEnvelopeSafe: boolean = await new Sandbox('VerifyEnvelopeIntegrity').run(
      {
        Data: data,
        PublicKey: publicKey,
        Signature: signature,
      },
      Verifier.sandboxOptions
    );
    if (isEnvelopeSafe === false) {
      throw new IntegrityError(
        `Signature was invalid. Sig: ${signature.toString('base64')}, Data: ${data.toString('base64')}`
      );
    }
  }

  public static async verifyFileIntegrity(file: Buffer, expectedChecksum: Buffer): Promise<void> {
    const calculatedChecksum: Buffer = await new Sandbox('VerifyFileIntegrity').run(
      {
        FileAsBuffer: file,
      },
      Verifier.sandboxOptions
    );

    if (calculatedChecksum.equals(expectedChecksum) === false) {
      throw new IntegrityError(
        `Checksum verification failed. Checksum: ${calculatedChecksum.toString(
          'hex'
        )}, Expected checksum: ${expectedChecksum.toString('hex')}`
      );
    }
  }
}