import {
  AfterViewChecked,
  Component,
  ElementRef,
  HostBinding,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  TemplateRef,
  ViewChild,
} from '@angular/core';
import { ChannelService } from '../channel.service';
import { Observable, Subscription } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import {
  MessageContext,
  DefaultStreamChatGenerics,
  StreamMessage,
  TypingIndicatorContext,
} from '../types';
import { ChatClientService } from '../chat-client.service';
import { getGroupStyles, GroupStyle } from './group-styles';
import { ImageLoadService } from './image-load.service';
import { UserResponse } from 'stream-chat';
import { CustomTemplatesService } from '../custom-templates.service';

/**
 * The `MessageList` component renders a scrollable list of messages.
 */
@Component({
  selector: 'stream-message-list',
  templateUrl: './message-list.component.html',
  styles: [],
})
export class MessageListComponent
  implements AfterViewChecked, OnChanges, OnInit, OnDestroy
{
  /**
   * Determines if the message list should display channel messages or [thread messages](https://getstream.io/chat/docs/javascript/threads/?language=javascript).
   */
  @Input() mode: 'main' | 'thread' = 'main';
  /**
   * The direction of the messages in the list, `bottom-to-top` means newest message is at the bottom of the message list and users scroll upwards to load older messages
   */
  @Input() direction: 'bottom-to-top' | 'top-to-bottom' = 'bottom-to-top';
  typingIndicatorTemplate: TemplateRef<TypingIndicatorContext> | undefined;
  messageTemplate: TemplateRef<MessageContext> | undefined;
  messages$!: Observable<StreamMessage[]>;
  enabledMessageActions: string[] = [];
  @HostBinding('class') private class =
    'str-chat-angular__main-panel-inner str-chat-angular__message-list-host';
  unreadMessageCount = 0;
  isUserScrolled: boolean | undefined;
  groupStyles: GroupStyle[] = [];
  lastSentMessageId: string | undefined;
  parentMessage: StreamMessage | undefined;
  @ViewChild('scrollContainer')
  private scrollContainer!: ElementRef<HTMLElement>;
  @ViewChild('parentMessageElement')
  private parentMessageElement!: ElementRef<HTMLElement>;
  private latestMessageDate: Date | undefined;
  private hasNewMessages: boolean | undefined;
  private containerHeight: number | undefined;
  private oldestMessageDate: Date | undefined;
  private olderMassagesLoaded: boolean | undefined;
  private isNewMessageSentByUser: boolean | undefined;
  private readonly isUserScrolledUpThreshold = 300;
  private subscriptions: Subscription[] = [];
  private prevScrollTop: number | undefined;
  private usersTypingInChannel$!: Observable<
    UserResponse<DefaultStreamChatGenerics>[]
  >;
  private usersTypingInThread$!: Observable<
    UserResponse<DefaultStreamChatGenerics>[]
  >;

  constructor(
    private channelService: ChannelService,
    private chatClientService: ChatClientService,
    private imageLoadService: ImageLoadService,
    private customTemplatesService: CustomTemplatesService
  ) {
    this.subscriptions.push(
      this.channelService.activeChannel$.subscribe((channel) => {
        this.resetScrollState();
        const capabilites = channel?.data?.own_capabilities as string[];
        if (capabilites) {
          this.enabledMessageActions = capabilites;
        }
      })
    );
    this.subscriptions.push(
      this.imageLoadService.imageLoad$.subscribe(() => {
        if (!this.isUserScrolled && this.direction === 'bottom-to-top') {
          this.scrollToBottom();
          // Hacky and unreliable workaround to scroll down after loaded images move the scrollbar
          setTimeout(() => {
            this.scrollToBottom();
          }, 300);
        }
      })
    );
    this.subscriptions.push(
      this.channelService.activeParentMessage$.subscribe((message) => {
        if (
          message &&
          this.parentMessage &&
          message.id !== this.parentMessage.id &&
          this.mode === 'thread'
        ) {
          this.resetScrollState();
        }
        this.parentMessage = message;
      })
    );
    this.subscriptions.push(
      this.customTemplatesService.messageTemplate$.subscribe(
        (template) => (this.messageTemplate = template)
      )
    );
    this.subscriptions.push(
      this.customTemplatesService.typingIndicatorTemplate$.subscribe(
        (template) => (this.typingIndicatorTemplate = template)
      )
    );
    this.usersTypingInChannel$ = this.channelService.usersTypingInChannel$;
    this.usersTypingInThread$ = this.channelService.usersTypingInThread$;
  }

  ngOnInit(): void {
    this.setMessages$();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.mode || changes.direction) {
      this.setMessages$();
    }
    if (changes.direction) {
      if (this.scrollContainer?.nativeElement) {
        this.scrollToLatestMessage();
      }
    }
  }

  ngAfterViewChecked() {
    if (this.direction === 'top-to-bottom') {
      if (
        this.hasNewMessages &&
        (this.isNewMessageSentByUser || !this.isUserScrolled)
      ) {
        this.scrollToTop();
        this.hasNewMessages = false;
        this.containerHeight = this.scrollContainer.nativeElement.scrollHeight;
      }
    } else {
      if (this.hasNewMessages) {
        if (!this.isUserScrolled || this.isNewMessageSentByUser) {
          this.scrollToBottom();
          // Hacky and unreliable workaround to scroll down after loaded images move the scrollbar
          setTimeout(() => {
            this.scrollToBottom();
          }, 300);
        }
        this.hasNewMessages = false;
        this.containerHeight = this.scrollContainer.nativeElement.scrollHeight;
      } else if (this.olderMassagesLoaded) {
        this.preserveScrollbarPosition();
        this.containerHeight = this.scrollContainer.nativeElement.scrollHeight;
        this.olderMassagesLoaded = false;
      } else if (
        this.containerHeight !== undefined &&
        this.containerHeight <
          this.scrollContainer.nativeElement.scrollHeight &&
        !this.isUserScrolled
      ) {
        this.scrollToBottom();
        this.containerHeight = this.scrollContainer.nativeElement.scrollHeight;
      }
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  trackByMessageId(index: number, item: StreamMessage) {
    return item.id;
  }

  trackByUserId(index: number, user: UserResponse) {
    return user.id;
  }

  scrollToLatestMessage() {
    this.direction === 'bottom-to-top'
      ? this.scrollToBottom()
      : this.scrollToTop();
  }

  scrollToBottom(): void {
    this.scrollContainer.nativeElement.scrollTop =
      this.scrollContainer.nativeElement.scrollHeight;
  }

  scrollToTop() {
    this.scrollContainer.nativeElement.scrollTop = 0;
  }

  scrolled() {
    this.isUserScrolled =
      this.direction === 'bottom-to-top'
        ? this.scrollContainer.nativeElement.scrollHeight -
            (this.scrollContainer.nativeElement.scrollTop +
              this.scrollContainer.nativeElement.clientHeight) >
          this.isUserScrolledUpThreshold
        : this.scrollContainer.nativeElement.scrollTop > 0;
    if (!this.isUserScrolled) {
      this.unreadMessageCount = 0;
    }
    if (this.shouldLoadMoreMessages()) {
      this.containerHeight = this.scrollContainer.nativeElement.scrollHeight;
      this.mode === 'main'
        ? void this.channelService.loadMoreMessages()
        : void this.channelService.loadMoreThreadReplies();
    }
    this.prevScrollTop = this.scrollContainer.nativeElement.scrollTop;
  }

  getTypingIndicatorContext(): TypingIndicatorContext {
    return {
      usersTyping$: this.usersTyping$,
    };
  }

  getMessageContext(message: StreamMessage): MessageContext {
    return {
      message,
      isLastSentMessage: !!(
        this.lastSentMessageId && message?.id === this.lastSentMessageId
      ),
      enabledMessageActions: this.enabledMessageActions,
      mode: this.mode,
    };
  }

  private preserveScrollbarPosition() {
    this.scrollContainer.nativeElement.scrollTop =
      (this.prevScrollTop || 0) +
      (this.scrollContainer.nativeElement.scrollHeight - this.containerHeight!);
  }

  private shouldLoadMoreMessages() {
    if (this.direction === 'bottom-to-top') {
      return (
        this.scrollContainer.nativeElement.scrollTop <=
          (this.parentMessageElement?.nativeElement.clientHeight || 0) &&
        (this.prevScrollTop === undefined ||
          this.prevScrollTop >
            (this.parentMessageElement?.nativeElement.clientHeight || 0))
      );
    } else {
      return (
        this.scrollContainer.nativeElement.scrollTop +
          this.scrollContainer.nativeElement.clientHeight >=
        this.scrollContainer.nativeElement.scrollHeight
      );
    }
  }

  private setMessages$() {
    this.messages$ = (
      this.mode === 'main'
        ? this.channelService.activeChannelMessages$
        : this.channelService.activeThreadMessages$
    ).pipe(
      tap((messages) => {
        if (messages.length === 0) {
          return;
        }
        const currentLatestMessageDate =
          messages[messages.length - 1].created_at;
        if (
          !this.latestMessageDate ||
          this.latestMessageDate?.getTime() < currentLatestMessageDate.getTime()
        ) {
          this.latestMessageDate = currentLatestMessageDate;
          this.hasNewMessages = true;
          this.isNewMessageSentByUser =
            messages[messages.length - 1].user?.id ===
            this.chatClientService.chatClient?.user?.id;
          if (this.isUserScrolled) {
            this.unreadMessageCount++;
          }
        }
        const currentOldestMessageDate = messages[0].created_at;
        if (!this.oldestMessageDate) {
          this.oldestMessageDate = currentOldestMessageDate;
        } else if (
          this.oldestMessageDate?.getTime() > currentOldestMessageDate.getTime()
        ) {
          this.oldestMessageDate = currentOldestMessageDate;
          this.olderMassagesLoaded = true;
        }
      }),
      tap(
        (messages) =>
          (this.lastSentMessageId = [...messages]
            .reverse()
            .find(
              (m) =>
                m.user?.id === this.chatClientService.chatClient?.user?.id &&
                m.status !== 'sending'
            )?.id)
      ),
      map((messages) =>
        this.direction === 'bottom-to-top' ? messages : [...messages].reverse()
      ),
      tap((messages) => {
        this.groupStyles = messages.map((m, i) =>
          getGroupStyles(m, messages[i - 1], messages[i + 1])
        );
      })
    );
  }

  private resetScrollState() {
    this.latestMessageDate = undefined;
    this.hasNewMessages = true;
    this.isUserScrolled = false;
    this.containerHeight = undefined;
    this.olderMassagesLoaded = false;
    this.oldestMessageDate = undefined;
    this.unreadMessageCount = 0;
    this.prevScrollTop = undefined;
    this.isNewMessageSentByUser = undefined;
  }

  private get usersTyping$() {
    return this.mode === 'thread'
      ? this.usersTypingInThread$
      : this.usersTypingInChannel$;
  }
}
