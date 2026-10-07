import { Component, Event, EventEmitter, Prop, h } from '@stencil/core';
import NoIDDetected from '@animations/id-scan/NoIDDetected.json';
import WrongID from '@animations/id-scan/WrongID.json';
import Pause from '@animations/id-scan/PausedLoader.json';
import { Translation } from '@utils/translation';

interface Issue {
  type: string;
  title: string;
  description: string;
  animation?: string;
  /**
   * Translation key for the button, when "Try again" is the wrong words for
   * what the button does. Falls back to `id-scan-try-again`.
   */
  button?: string;
}

const ISSUES = {
  GLARE: {
    type: 'ISSUE',
    title: 'id-scan-too-much-glare',
    description: 'id-scan-glare-advice',
  },
  BLUR: {
    type: 'ISSUE',
    title: 'id-scan-too-blurry',
    description: 'id-scan-blur-advice',
  },
  CLOSE: {
    type: 'ISSUE',
    title: 'id-scan-too-close',
    description: 'id-scan-close-advice',
  },
  FURTHER: {
    type: 'ISSUE',
    title: 'id-scan-too-far',
    description: 'id-scan-close-advice',
  },
  CENTER: {
    type: 'ISSUE',
    title: 'id-scan-out-of-frame',
    description: 'id-scan-retry',
  },
  TIMEOUT: {
    type: 'FAILURE',
    title: 'id-scan-failed',
    description: 'id-scan-failure-message',
    animation: NoIDDetected,
  },
  UNSUPPORTED: {
    type: 'FAILURE',
    title: 'id-scan-validity-question',
    description: 'id-scan-validity-advice',
    animation: WrongID,
  },
  UNREADABLE: {
    type: 'FAILURE',
    title: 'id-scan-not-captured',
    description: 'id-scan-visibility-advice',
    animation: NoIDDetected,
  },
  PAUSE: {
    type: 'PAUSE',
    title: 'id-scan-paused',
    description: 'id-scan-position-id',
    animation: Pause,
    // The only screen here that is not a failure: the scan never stopped, so
    // the button resumes it rather than retrying anything.
    button: 'id-scan-paused-continue',
  },
};

@Component({
  tag: 'id-scan-issue',
  styleUrl: 'id-scan.scss',
  shadow: true,
})
export class IDScanIssue {
  @Prop() name: string = 'GLARE';
  @Prop() visible: boolean;
  @Prop() translation: Translation = new Translation();
  @Prop() imageExample: string = null;

  @Event() tryAgain: EventEmitter<void>;
  @Event() validDocumentConfirmed: EventEmitter<boolean>;

  render() {
    const issue: Issue = structuredClone(ISSUES[this.name]);

    if (!issue) {
      return <div></div>;
    }

    issue.title = (this.translation._t(issue.title) || issue.title).toString();
    issue.description = (this.translation._t(issue.description) || issue.title).toString();

    if (this.name === 'UNSUPPORTED') {
      const buttons = [
        {
          text: this.translation._t('response-yes').toString(),
          variant: 'gray',
          btnClick: () => this.validDocumentConfirmed.emit(true),
        },
        {
          text: this.translation._t('response-no').toString(),
          variant: 'orange',
          btnClick: () => this.validDocumentConfirmed.emit(false),
        },
      ];
      return (
        <id-scan-exception
          translation={this.translation}
          name="FAILURE"
          issue={issue}
          animation={WrongID}
          imageExample={this.imageExample}
          buttons={buttons}
          visible={this.visible}
        />
      );
    }

    return (
      <id-scan-exception
        translation={this.translation}
        name={issue.type}
        issue={issue}
        animation={issue.animation}
        imageExample={this.imageExample}
        // Stencil patches the same element across issues, and a prop that is
        // only passed on one branch keeps its old value on all the others --
        // so the unsupported screen's Yes/No pair has to be cleared here, not
        // just omitted.
        buttons={[]}
        button-variant="orange"
        button-text={this.translation._t(issue.button || 'id-scan-try-again')}
        visible={this.visible}
        onBtnClick={() => this.tryAgain.emit()}
      />
    );
  }
}
