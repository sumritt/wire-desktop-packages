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

import * as Updater from '@wireapp/desktop-updater-spec';
import * as React from 'react';
import {Prompt} from './PromptView';

export interface PromptContainerState {
  manifest?: Updater.Manifest;
  changelogUrl: string;
  isWebappBlacklisted: boolean;
  isWebappTamperedWith: boolean;
}

interface Props {}

class PromptContainer extends React.Component<Props, PromptContainerState> {
  constructor(props) {
    super(props);
    this.state = props;
  }

  render() {
    return <Prompt {...this.state} />;
  }
}

export {PromptContainer};
