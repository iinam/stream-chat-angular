import { Component, Input, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  Channel,
  Event,
  FormatMessageResponse,
  MessageResponse,
} from 'stream-chat';
import { ChannelService } from '../channel.service';
import { getChannelDisplayText } from '../get-channel-display-text';
import { DefaultStreamChatGenerics } from '../types';
import { ChatClientService } from '../chat-client.service';

/**
 * The `ChannelPreview` component displays a channel preview in the channel list, it consists of the image, name and latest message of the channel.
 */
@Component({
  selector: 'stream-channel-preview',
  templateUrl: './channel-preview.component.html',
  styles: [],
})
export class ChannelPreviewComponent implements OnInit, OnDestroy {
  /**
   * The channel to be displayed
   */
  @Input() channel: Channel<DefaultStreamChatGenerics> | undefined;
  isActive = false;
  isUnread = false;
  latestMessage: string = 'streamChat.Nothing yet...';
  private subscriptions: (Subscription | { unsubscribe: () => void })[] = [];
  private canSendReadEvents = true;

  constructor(
    private channelService: ChannelService,
    private ngZone: NgZone,
    private chatClientService: ChatClientService
  ) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.channelService.activeChannel$.subscribe(
        (activeChannel) =>
          (this.isActive = activeChannel?.id === this.channel?.id)
      )
    );
    const messages = this.channel?.state?.messages;
    if (messages && messages.length > 0) {
      this.setLatestMessage(messages[messages.length - 1]);
    }
    this.isUnread = !!this.channel!.countUnread() && this.canSendReadEvents;
    const capabilities =
      (this.channel?.data?.own_capabilities as string[]) || [];
    this.canSendReadEvents = capabilities.indexOf('read-events') !== -1;
    this.subscriptions.push(
      this.channel!.on('message.new', this.handleMessageEvent.bind(this))
    );
    this.subscriptions.push(
      this.channel!.on('message.updated', this.handleMessageEvent.bind(this))
    );
    this.subscriptions.push(
      this.channel!.on('message.deleted', this.handleMessageEvent.bind(this))
    );
    this.subscriptions.push(
      this.channel!.on('channel.truncated', this.handleMessageEvent.bind(this))
    );
    this.subscriptions.push(
      this.channel!.on('message.read', () =>
        this.ngZone.run(() => {
          this.isUnread =
            !!this.channel!.countUnread() && this.canSendReadEvents;
        })
      )
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  get avatarImage() {
    return this.channel?.data?.image;
  }

  get avatarName() {
    return this.channel?.data?.name;
  }

  get title() {
    if (!this.channel) {
      return '';
    }
    return getChannelDisplayText(
      this.channel,
      this.chatClientService.chatClient.user!
    );
  }

  setAsActiveChannel(): void {
    void this.channelService.setAsActiveChannel(this.channel!);
  }

  private handleMessageEvent(event: Event) {
    this.ngZone.run(() => {
      if (this.channel?.state.messages.length === 0) {
        this.latestMessage = 'streamChat.Nothing yet...';
        return;
      }
      if (
        !event.message ||
        this.channel?.state.messages[this.channel?.state.messages.length - 1]
          .id !== event.message.id
      ) {
        return;
      }
      this.setLatestMessage(event.message);
      this.isUnread = !!this.channel.countUnread() && this.canSendReadEvents;
    });
  }

  private setLatestMessage(message?: FormatMessageResponse | MessageResponse) {
    if (message?.deleted_at) {
      this.latestMessage = 'streamChat.Message deleted';
    } else if (message?.text) {
      this.latestMessage = message.text;
    } else if (message?.attachments && message.attachments.length) {
      this.latestMessage = 'streamChat.🏙 Attachment...';
    }
  }
}
