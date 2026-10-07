import { Component, Element, Method, Prop, Watch, h } from '@stencil/core';
import lottie, { AnimationItem } from 'lottie-web/build/player/lottie_light';

@Component({
  tag: 'idv-animation',
  styleUrl: 'idv-animation.scss',
})
export class IDVerseAnimation {
  @Prop() name: string = '';
  @Prop() animationData: any = '';
  @Prop() classes?: string = '';
  @Prop() play?: boolean = false;
  @Prop() delay?: number = 0;
  @Prop() startAt?: number = 0;
  @Prop() loop?: boolean = true;
  @Prop() visible?: boolean = true;

  @Element() host: HTMLDivElement;

  private layer?: HTMLElement;
  protected instance: AnimationItem;

  componentDidLoad() {
    this.loadAnimation(this.animationData, this.delay);
  }

  loadAnimation(animationData: any, delay: number) {
    this.layer.innerHTML = '';
    this.instance = lottie.loadAnimation({
      container: this.layer,
      renderer: 'svg',
      loop: this.loop,
      autoplay: this.play && !delay,
      animationData,
      name: this.name,
    });

    if (delay) {
      if (this.startAt) {
        this.instance.goToAndStop(this.startAt);
      }
      setTimeout(() => this.instance.goToAndPlay(this.startAt), delay);
    } else {
      if (this.startAt) {
        this.instance.goToAndPlay(this.startAt);
      }
    }
  }

  @Method()
  async getAnimation() {
    return this.instance;
  }

  /**
   * Whenever to play the animation in loop.
   */
  @Watch('loop')
  watchLoop(loop: boolean) {
    if (this.instance) {
      this.instance.loop = loop;
    }
  }

  /**
   * Whenever to play the animation in loop.
   */
  @Watch('delay')
  watchDelay(delay: number) {
    if (this.instance) {
      this.instance.goToAndStop(0);
      setTimeout(() => this.instance.play(this.name), delay);
    }
  }

  /**
   * Whenever to play the animation, this method will fire.
   */
  @Watch('animationData')
  watchAnimationData(newAnimationData: any) {
    this.loadAnimation(newAnimationData, this.delay);
  }

  /**
   * Whenever to play the animation, this method will fire.
   */
  @Watch('play')
  watchPropHandler(play: boolean) {
    if (play) {
      this.instance.play(this.name);
    } else {
      this.instance.pause(this.name);
    }
  }

  render() {
    return (
      <div
        class={{
          'idv-animation': true,
          'success': this.name === 'success',
          'visible': this.visible,
        }}
      >
        <div
          class={this.classes}
          ref={el => (this.layer = el as HTMLElement)}
          id={`idv-animation-${this.name}`}
        ></div>
        <slot />
      </div>
    );
  }
}
