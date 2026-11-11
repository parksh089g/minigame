import Phaser from 'phaser';
import { registerTextures } from '../art/textures';
import { SCENE } from '../config';

/** 텍스처를 만든 뒤 허브로 넘어간다. 글꼴과 세이브는 main.ts에서 이미 불러온 상태다. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE.boot);
  }

  create(): void {
    registerTextures(this);
    this.scene.start(SCENE.hub);
  }
}
