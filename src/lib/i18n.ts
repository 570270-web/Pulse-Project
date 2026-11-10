import { useEffect, useState } from 'react';

export type Lang = 'ko' | 'en';

const STORAGE_KEY = 'pulse_lang';
const listeners = new Set<(lang: Lang) => void>();

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored === 'ko' || stored === 'en') return stored;
  } catch {
    // 저장소를 쓸 수 없으면 기본값
  }

  return 'ko';
}

let currentLang: Lang = readStoredLang();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(next: Lang) {
  if (next === currentLang) return;

  currentLang = next;

  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 저장 실패는 무시 (이번 접속 동안만 적용됨)
  }

  listeners.forEach((listener) => listener(next));
}

const dict = {
  ko: {
    'common.close': '닫기',
    'common.cancel': '취소',
    'common.delete': '삭제',
    'common.edit': '편집',
    'common.me': '(나)',
    'lang.toggle': '언어 변경',
    'notify.turnOn': '새 메시지 알림 켜기',
    'notify.turnOff': '새 메시지 알림 끄기',
    'notify.blocked': '브라우저에서 알림이 차단되어 있어요. 주소창 옆 자물쇠 설정에서 알림을 허용해 주세요.',
    'notify.title': '{room}',

    'chat.backToHub': '방 목록으로',
    'chat.reply': '답장',
    'chat.messageOptions': '메시지 옵션',
    'chat.members': '참여자 보기',
    'chat.settings': '방 설정',
    'chat.theme': '테마 변경',
    'chat.owner': '방장',
    'chat.coAdmin': '부방장',
    'chat.siteAdmin': '사이트 관리자',
    'chat.originalMessage': '원본 메시지',
    'chat.deletedMessage': '삭제된 메시지',
    'chat.originalUnavailable': '원본 메시지를 불러올 수 없습니다.',
    'chat.deletedNotice': '삭제된 메시지입니다.',
    'chat.editing': '편집 중...',
    'chat.loading': '메시지를 불러오는 중...',
    'chat.empty': '아직 메시지가 없어요',
    'chat.emptyHint': '첫 인사를 건네 보세요!',
    'chat.loadOlder': '이전 메시지 더 보기',
    'chat.startOfChat': '대화의 시작입니다',
    'chat.newMessages': '새 메시지 {n}개',
    'chat.jumpLatest': '최신으로',
    'chat.typingOne': '{name}님이 입력 중...',
    'chat.typingMany': '{name}님 외 {n}명이 입력 중...',
    'chat.closeError': '오류 닫기',
    'chat.editMessage': '메시지 편집',
    'chat.replyTo': '{name}에게 답장',
    'chat.cancel': '취소',
    'chat.insertLink': '링크 삽입',
    'chat.phEdit': '메시지 수정...',
    'chat.phCooldown': '{n}초 뒤에 다시 보낼 수 있어요',
    'chat.phReply': '{name}에게 답장...',
    'chat.phSend': '{room}에 메시지 보내기...',
    'chat.cancelEdit': '편집 취소',
    'chat.saveEdit': '수정 저장',
    'chat.send': '메시지 전송',
    'chat.addToInput': '입력창에 추가',
    'chat.openLinkTitle': '링크를 열까요?',
    'chat.openLinkBodyPre': '새 탭에서 ',
    'chat.openLinkBodyPost': '(으)로 이동합니다.',
    'chat.open': '열기',
    'chat.invalidLink': '잘못된 링크 형식입니다. (http:// 또는 https:// 로 시작)',
    'chat.editFailed': '메시지를 수정하지 못했습니다.',
    'chat.deleteFailed': '메시지를 삭제하지 못했습니다.',
    'chat.actionFailed': '작업 중 오류가 발생했습니다.',
    'chat.rateLimit':
      '메시지는 1분에 {max}개까지 보낼 수 있어요. {n}초 뒤에 다시 보내 주세요.',
    'chat.attachPhoto': '사진',
    'chat.photoLabel': '사진',
    'chat.photoRemove': '사진 삭제',
    'chat.photoUploading': '사진 올리는 중...',
    'chat.imageType': '이미지 파일만 올릴 수 있습니다. (JPG, PNG, WEBP, GIF)',
    'chat.imageTooLarge': '이미지가 너무 큽니다. {mb}MB 이하만 올릴 수 있습니다.',
    'chat.imageUpload': '사진을 올리지 못했습니다. 잠시 뒤 다시 시도해 주세요.',

    'chat.membersTitle': '참여자',
    'chat.online': '접속 중',
    'chat.offline': '오프라인',
    'chat.readCount': '읽음 {n}',
    'chat.readTitle': '읽은 사람',
    'chat.readGroup': '읽음',
    'chat.unreadGroup': '안 읽음',
    'chat.readEmpty': '아직 없음',
    'chat.block': '강퇴',
    'chat.unblock': '차단 해제',
    'chat.blockedBadge': '차단됨',
    'chat.blockedList': '차단 목록',
    'chat.blockedEmpty': '차단된 멤버가 없어요.',
    'chat.blockedLeft': '이미 나간 멤버',
    'chat.blockTitle': '이 멤버를 강퇴할까요?',
    'chat.blockBody':
      '{name}님은 이 방의 메시지 기록과 입력이 막힙니다. 계정 자체는 삭제되지 않고 그대로 남습니다.',
    'chat.unblockTitle': '차단을 해제할까요?',
    'chat.unblockBody': '{name}님이 이 방을 다시 보고 쓸 수 있게 됩니다.',
    'chat.blockedRoomTitle': '이 방에서 차단되었습니다',
    'chat.blockedRoomBody':
      '방장이 이 방의 메시지 기록과 입력을 막았습니다. 계정은 그대로 남아 있으니, 다시 이용하려면 방장에게 문의해 주세요.',
    'err.roomBlocked': '이 방에서 차단되어 메시지를 볼 수 없습니다.',

    'chat.settingsTitle': '방 설정',
    'chat.roomName': '방 이름',
    'chat.rename': '변경',
    'chat.renamed': '방 이름을 바꿨어요.',
    'chat.roomPassword': '입장 비밀번호',
    'chat.privateRoom': '비공개 방',
    'chat.publicRoom': '공개 방',
    'chat.noPasswordYet':
      '아직 비밀번호가 없어서 새로 들어올 수 있는 사람이 없어요. 아래에서 비밀번호를 정해 주세요.',
    'chat.restrictedInfo':
      '새로 들어오려는 사람은 비밀번호가 필요해요. 이미 들어와 있는 사람은 그대로 유지돼요.',
    'chat.publicInfo':
      '비밀번호를 걸면 이 방은 비공개 방이 되고, 방 목록에서 검색되지 않아요.',
    'chat.pwLength': '비밀번호는 4~128자여야 합니다.',
    'chat.pwSet': '비밀번호를 설정했어요. 새로 들어오는 사람은 비밀번호가 필요해요.',
    'chat.pwCleared': '비밀번호를 해제했어요. 이제 공개 방이에요.',
    'chat.phNewPw': '새 비밀번호 (4자 이상)',
    'chat.phPw': '비밀번호 (4자 이상)',
    'chat.changePw': '비밀번호 변경',
    'chat.setPw': '비밀번호 걸기',
    'chat.clearPw': '비밀번호 해제 (공개로)',
    'chat.saving': '저장 중...',
    'chat.deleteConfirmTitle': '메시지를 삭제할까요?',
    'chat.deleteConfirmBody':
      '삭제한 메시지는 채팅에서 "삭제된 메시지"로 표시됩니다.',

    'support.title': '관리자 문의',
    'support.threadTitle': '{name} 님의 문의',
    'support.emptyUser': '문의 내용을 남겨 주세요.\n확인 후 이곳에서 답변드립니다.',
    'support.emptyAdmin': '아직 대화가 없어요.',
    'support.admin': '관리자',
    'support.phUser': '문의 내용을 입력하세요',
    'support.phAdmin': '답변을 입력하세요',
    'support.send': '보내기',

    'inbox.search': '문의한 계정 검색...',
    'inbox.refresh': '새로고침',
    'inbox.noMessages': '아직 메시지 없음',
    'inbox.none': '아직 들어온 문의가 없어요.',
    'inbox.noResults': '검색 결과가 없어요.',
    'inbox.count': '메시지 {n}개',
    'inbox.needsReply': '답변 필요',

    'err.pwLength': '비밀번호는 4~128자여야 합니다.',
    'err.roomPw': '방 비밀번호가 올바르지 않습니다.',
    'err.notMember': '이 방의 멤버가 아닙니다.',
    'err.session': '세션이 만료되었습니다. 다시 로그인해 주세요.',
    'err.content': '메시지는 1~500자여야 합니다.',
    'err.replyTarget': '답장할 메시지를 찾을 수 없습니다.',
    'err.roomName': '방 이름은 2~50자여야 합니다.',
    'err.permission': '이 작업을 할 권한이 없습니다.',
    'err.threadNotFound': '해당 문의를 찾을 수 없습니다.',
    'err.roomNotFound': '방을 찾을 수 없습니다.',
    'err.adminSupport': '관리자 계정은 문의를 보낼 수 없습니다.',
    'err.notAdmin': '관리자 권한이 필요합니다.',
    'err.unknown': '알 수 없는 오류가 발생했습니다.',
    'err.rate': '메시지는 1분에 6개까지 보낼 수 있어요. {n}초 뒤에 다시 보내 주세요.',

    'sys.joined': '{name}님이 입장했습니다.',
  },
  en: {
    'common.close': 'Close',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.me': '(you)',
    'lang.toggle': 'Change language',
    'notify.turnOn': 'Turn on new message notifications',
    'notify.turnOff': 'Turn off new message notifications',
    'notify.blocked': 'Notifications are blocked in your browser. Allow them from the lock icon next to the address bar.',
    'notify.title': '{room}',

    'chat.backToHub': 'Back to rooms',
    'chat.reply': 'Reply',
    'chat.messageOptions': 'Message options',
    'chat.members': 'View members',
    'chat.settings': 'Room settings',
    'chat.theme': 'Toggle theme',
    'chat.owner': 'Owner',
    'chat.coAdmin': 'Co-admin',
    'chat.siteAdmin': 'Site admin',
    'chat.originalMessage': 'Original message',
    'chat.deletedMessage': 'Deleted message',
    'chat.originalUnavailable': 'The original message could not be loaded.',
    'chat.deletedNotice': 'This message was deleted.',
    'chat.editing': 'Editing...',
    'chat.loading': 'Loading messages...',
    'chat.empty': 'No messages yet',
    'chat.emptyHint': 'Say hello!',
    'chat.loadOlder': 'Load earlier messages',
    'chat.startOfChat': 'This is the beginning of the conversation',
    'chat.newMessages': '{n} new messages',
    'chat.jumpLatest': 'Jump to latest',
    'chat.typingOne': '{name} is typing...',
    'chat.typingMany': '{name} and {n} others are typing...',
    'chat.closeError': 'Dismiss error',
    'chat.editMessage': 'Edit message',
    'chat.replyTo': 'Replying to {name}',
    'chat.cancel': 'Cancel',
    'chat.insertLink': 'Insert link',
    'chat.phEdit': 'Edit message...',
    'chat.phCooldown': 'You can send again in {n}s',
    'chat.phReply': 'Reply to {name}...',
    'chat.phSend': 'Message {room}...',
    'chat.cancelEdit': 'Cancel edit',
    'chat.saveEdit': 'Save edit',
    'chat.send': 'Send message',
    'chat.addToInput': 'Add to message',
    'chat.openLinkTitle': 'Open this link?',
    'chat.openLinkBodyPre': 'This will open ',
    'chat.openLinkBodyPost': ' in a new tab.',
    'chat.open': 'Open',
    'chat.invalidLink': 'Invalid link. It must start with http:// or https://',
    'chat.editFailed': 'Could not edit the message.',
    'chat.deleteFailed': 'Could not delete the message.',
    'chat.actionFailed': 'Something went wrong.',
    'chat.rateLimit':
      'You can send up to {max} messages per minute. Try again in {n}s.',
    'chat.attachPhoto': 'Photo',
    'chat.photoLabel': 'Photo',
    'chat.photoRemove': 'Remove photo',
    'chat.photoUploading': 'Uploading photo...',
    'chat.imageType': 'Only image files can be uploaded (JPG, PNG, WEBP, GIF).',
    'chat.imageTooLarge': 'That image is too large. Up to {mb}MB is allowed.',
    'chat.imageUpload': 'Could not upload the photo. Please try again.',

    'chat.membersTitle': 'Members',
    'chat.online': 'Online',
    'chat.offline': 'Offline',
    'chat.readCount': 'Read {n}',
    'chat.readTitle': 'Read by',
    'chat.readGroup': 'Read',
    'chat.unreadGroup': 'Not yet',
    'chat.readEmpty': 'None yet',
    'chat.block': 'Remove',
    'chat.unblock': 'Undo',
    'chat.blockedBadge': 'Blocked',
    'chat.blockedList': 'Blocked',
    'chat.blockedEmpty': 'No blocked members.',
    'chat.blockedLeft': 'Left the room',
    'chat.blockTitle': 'Remove this member?',
    'chat.blockBody':
      '{name} will no longer be able to read or send messages in this room. Their account stays as it is.',
    'chat.unblockTitle': 'Undo this block?',
    'chat.unblockBody': '{name} can read and send in this room again.',
    'chat.blockedRoomTitle': 'You were blocked in this room',
    'chat.blockedRoomBody':
      'The room owner blocked the message history and sending here. Your account is unchanged — ask the owner if you want access again.',
    'err.roomBlocked': 'You are blocked in this room.',

    'chat.settingsTitle': 'Room settings',
    'chat.roomName': 'Room name',
    'chat.rename': 'Rename',
    'chat.renamed': 'Room name updated.',
    'chat.roomPassword': 'Room password',
    'chat.privateRoom': 'Private room',
    'chat.publicRoom': 'Public room',
    'chat.noPasswordYet':
      'No password is set yet, so nobody new can join. Set a password below.',
    'chat.restrictedInfo':
      'New members need the password to join. People already in the room stay in.',
    'chat.publicInfo':
      'Setting a password makes this room private and hides it from room search.',
    'chat.pwLength': 'Password must be 4–128 characters.',
    'chat.pwSet': 'Password set. New members will need it to join.',
    'chat.pwCleared': 'Password removed. This room is public now.',
    'chat.phNewPw': 'New password (4+ characters)',
    'chat.phPw': 'Password (4+ characters)',
    'chat.changePw': 'Change password',
    'chat.setPw': 'Set password',
    'chat.clearPw': 'Remove password (make public)',
    'chat.saving': 'Saving...',
    'chat.deleteConfirmTitle': 'Delete this message?',
    'chat.deleteConfirmBody':
      'Deleted messages appear as "This message was deleted." in the chat.',

    'support.title': 'Contact admin',
    'support.threadTitle': 'Inquiry from {name}',
    'support.emptyUser':
      'Leave your question here.\nWe will reply in this window.',
    'support.emptyAdmin': 'No messages yet.',
    'support.admin': 'Admin',
    'support.phUser': 'Type your question',
    'support.phAdmin': 'Type your reply',
    'support.send': 'Send',

    'inbox.search': 'Search accounts...',
    'inbox.refresh': 'Refresh',
    'inbox.noMessages': 'No messages yet',
    'inbox.none': 'No inquiries yet.',
    'inbox.noResults': 'No results.',
    'inbox.count': '{n} messages',
    'inbox.needsReply': 'Needs reply',

    'err.pwLength': 'Password must be 4–128 characters.',
    'err.roomPw': 'Incorrect room password.',
    'err.notMember': 'You are not a member of this room.',
    'err.session': 'Your session has expired. Please log in again.',
    'err.content': 'Messages must be 1–500 characters.',
    'err.replyTarget': 'The message you are replying to could not be found.',
    'err.roomName': 'Room name must be 2–50 characters.',
    'err.permission': 'You do not have permission to do this.',
    'err.threadNotFound': 'That inquiry could not be found.',
    'err.roomNotFound': 'Room not found.',
    'err.adminSupport': 'Admin accounts cannot send inquiries.',
    'err.notAdmin': 'Administrator permission required.',
    'err.unknown': 'An unknown error occurred.',
    'err.rate':
      'You can send up to 6 messages per minute. Try again in {n}s.',

    'sys.joined': '{name} joined the room.',
  },
} as const;

export type TKey = keyof (typeof dict)['ko'];

/** 현재 언어로 번역 ({name} 같은 자리표시자를 채움). 이벤트 처리 중에도 쓸 수 있다. */
export function tr(key: TKey, vars?: Record<string, string | number>): string {
  let text: string = dict[currentLang][key] ?? dict.ko[key] ?? key;

  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }

  return text;
}

/**
 * 시스템 메시지는 DB 에 한국어 문장으로 저장돼 있어서,
 * 영어 모드에서는 알려진 문장만 패턴으로 찾아 번역한다 (예전 메시지도 같이 번역됨).
 */
export function translateSystemMessage(content: string): string {
  if (currentLang === 'ko') return content;

  let match = /^(.+)님이 입장했습니다\.$/.exec(content);
  if (match) return `${match[1]} joined the room.`;

  match = /^방 이름이 "(.+)"\(으\)로 변경되었습니다\.$/.exec(content);
  if (match) return `The room was renamed to "${match[1]}".`;

  const fixed: Record<string, string> = {
    '이 방은 이제 공개 방입니다. (비밀번호 해제)':
      'This room is now public. (password removed)',
    '입장 비밀번호가 설정되었습니다.': 'A room password was set.',
    '비공개 방입니다. 방장이 방 설정에서 입장 비밀번호를 지정해 주세요.':
      'This is a private room. The owner should set a room password in room settings.',
  };

  return fixed[content] ?? content;
}

export function dateLocale(): string {
  return currentLang === 'ko' ? 'ko-KR' : 'en-US';
}

/** 컴포넌트가 언어 변경에 맞춰 다시 그려지도록 구독한다 */
export function useLang(): { lang: Lang; setLang: (lang: Lang) => void } {
  const [lang, setLocalLang] = useState<Lang>(currentLang);

  useEffect(() => {
    listeners.add(setLocalLang);
    setLocalLang(currentLang);

    return () => {
      listeners.delete(setLocalLang);
    };
  }, []);

  return { lang, setLang };
}