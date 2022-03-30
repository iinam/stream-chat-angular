import { Component } from '@angular/core';
import { MessageComponent } from 'stream-chat-angular';

@Component({
  selector: 'app-custom-message',
  templateUrl: './custom-message.component.html',
  styleUrls: ['./custom-message.component.scss'],
})
export class CustomMessageComponent extends MessageComponent {}
