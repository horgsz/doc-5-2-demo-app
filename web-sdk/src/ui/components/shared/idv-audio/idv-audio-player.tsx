import { Component, Method, Prop, State, h } from '@stencil/core';

export interface IdvAudioFile {
  readonly name: string;
  readonly src: {
    mp3: string;
    ogg: string;
  };
}

@Component({
  tag: 'idv-audio-player',
  shadow: true,
})
export class IdvAudioPlayer {
  @Prop() load: boolean = false;
  @Prop() files: IdvAudioFile[] = [];

  @State() sounds: { [key: string]: any } = {};

  /**
   * Returns sound file path
   * @param name name of the sound.
   * @returns sound file path.
   */
  getFilePath(name: string, mimetype: string) {
    const audio = this.files.find(file => file.name == name);
    return audio.src[mimetype];
  }

  /**
   * Plays the sounds based on the name.
   * @param name name of the sound.
   */
  @Method()
  async play(name: string) {
    if (this.sounds[name]) {
      try {
        this.sounds[name].muted = false;
        this.sounds[name].currentTime = 0;
        this.sounds[name].play();
        this.sounds[name].volume = 0.7;
      } catch (e) {
        console.warn('Failed to play sound:', name, e);
      }
    }
  }

  render() {
    return (
      <div style={{ position: 'absolute', width: '0px', height: '0px' }}>
        {this.load &&
          this.files.map(file => (
            <audio ref={ref => (this.sounds[file.name] = ref)} controls={false} muted autoPlay>
              <source src={file.src.mp3} />
              <source src={file.src.ogg} />
            </audio>
          ))}
      </div>
    );
  }
}
