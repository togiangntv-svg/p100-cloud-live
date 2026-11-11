import assert from 'node:assert/strict';
import {
  appendUserMessage,
  applyAiResponse,
  buildAiConversationWindow,
  correctUnderstanding,
  createInitialInteractionState,
  beginAiRequest,
  getAiSendingStatus,
  hydrateInteraction,
  grantAiContextConsent,
  serializeInteraction,
  setUserGoal,
  updateAiConsent,
} from '../domain/interaction.ts';
import { initialCoachingState, transitionStartStory } from '../domain/coaching.ts';

const now = '2026-09-10T08:00:00.000Z';

let state = createInitialInteractionState(now);
assert.equal(getAiSendingStatus(state), 'never_enabled', 'fresh state must say AI has never been enabled');
assert.equal(appendUserMessage(state, '   ', now), state, 'blank input must do nothing');
assert.equal(transitionStartStory(initialCoachingState, '   '), initialCoachingState, 'legacy blank input must not open categories');

state = appendUserMessage(state, 'Tôi nhớ con.', '2026-09-10T08:01:00.000Z');
assert.equal(state.messages[0]?.text, 'Tôi nhớ con.');
assert.equal(state.understandings[0]?.source, 'user_statement');
assert.equal('path' in state, false, 'natural interaction must not force a category');

state = appendUserMessage(state, 'Tôi vừa hoàn thành việc đó.', '2026-09-10T08:02:00.000Z');
assert.equal(state.messages[1]?.text, 'Tôi vừa hoàn thành việc đó.');
assert.equal(state.goal, null, 'completion must not become job seeking or a goal');

state = {
  ...grantAiContextConsent(state, '2026-09-10T08:03:00.000Z'),
  pendingRequest: {
    requestId: 'request-old',
    sequence: 3,
    createdAt: '2026-09-10T08:03:00.000Z',
    expiresAt: '2026-09-10T08:05:00.000Z',
  },
  latestRequestSequence: 3,
};
assert.equal(getAiSendingStatus(state), 'enabled', 'granted state must say sending is enabled');
const corrected = correctUnderstanding(state, 'Tôi chỉ đùa; chuyện chính là ca mổ ngày mai.', '2026-09-10T08:03:30.000Z');
assert.equal(corrected.pendingRequest, null, 'correction must cancel a pending response');
assert.equal(corrected.understandings.at(-1)?.source, 'user_correction');
assert.equal(
  applyAiResponse(corrected, 'request-old', 3, 'late response', '2026-09-10T08:04:00.000Z'),
  corrected,
  'late response must not enter the newer conversation',
);

let contextState = createInitialInteractionState('2026-09-10T09:00:00.000Z');
contextState = appendUserMessage(contextState, 'Lịch sử trước đồng ý.', '2026-09-10T09:00:10.000Z');
contextState = grantAiContextConsent(contextState, '2026-09-10T09:01:00.000Z');
assert.deepEqual(
  buildAiConversationWindow(contextState, 'Tôi muốn khỏe.'),
  [{ role: 'user', content: 'Tôi muốn khỏe.' }],
  'history before context consent must not be sent',
);

contextState = appendUserMessage(contextState, 'Tôi muốn khỏe.', '2026-09-10T09:01:10.000Z');
contextState = {
  ...contextState,
  messages: [
    ...contextState.messages,
    {
      id: 'assistant-health',
      role: 'assistant',
      text: '100 sẽ cùng bạn làm rõ điều khỏe có ý nghĩa gì.',
      createdAt: '2026-09-10T09:01:20.000Z',
      requestId: 'request-health',
      provenance: 'AI_EXTERNAL',
    },
  ],
};
assert.deepEqual(
  buildAiConversationWindow(contextState, 'Khỏe để uống rượu.'),
  [
    { role: 'user', content: 'Tôi muốn khỏe.' },
    { role: 'assistant', content: '100 sẽ cùng bạn làm rõ điều khỏe có ý nghĩa gì.' },
    { role: 'user', content: 'Khỏe để uống rượu.' },
  ],
  'the second request must include the immediately preceding user/assistant turn in order',
);

contextState = appendUserMessage(contextState, 'Bạn hiểu sai ý tôi.', '2026-09-10T09:01:30.000Z');
assert.deepEqual(
  buildAiConversationWindow(contextState, 'Ý mới của tôi là tập vừa sức.'),
  [
    { role: 'assistant', content: '100 sẽ cùng bạn làm rõ điều khỏe có ý nghĩa gì.' },
    { role: 'user', content: 'Bạn hiểu sai ý tôi.' },
    { role: 'user', content: 'Ý mới của tôi là tập vừa sức.' },
  ],
  'new information must replace older context outside the two-message window',
);

const stoppedContext = updateAiConsent(contextState, 'declined', '2026-09-10T09:02:00.000Z');
assert.equal(getAiSendingStatus(stoppedContext), 'stopped', 'stopping after an external response must say sending is stopped');
assert.deepEqual(
  buildAiConversationWindow(stoppedContext, 'Chủ đề mới.'),
  [{ role: 'user', content: 'Chủ đề mới.' }],
  'stopping external sending must remove access to prior context',
);
const restartedContext = grantAiContextConsent(stoppedContext, '2026-09-10T09:03:00.000Z');
assert.deepEqual(
  buildAiConversationWindow(restartedContext, 'Bắt đầu phiên mới.'),
  [{ role: 'user', content: 'Bắt đầu phiên mới.' }],
  'a new consent session must not reuse messages from the previous session',
);

const legacyGrant = {
  ...createInitialInteractionState('2026-09-10T09:10:00.000Z'),
  aiConsent: 'granted',
  aiConsentUpdatedAt: '2026-09-10T09:10:10.000Z',
};
assert.deepEqual(
  buildAiConversationWindow(legacyGrant, 'Quyền cũ.'),
  [{ role: 'user', content: 'Quyền cũ.' }],
  'legacy current-message-only consent must not silently expand to history',
);
const legacySaved = JSON.stringify({
  schemaVersion: 1,
  provenance: 'DEMO_LOCAL',
  state: legacyGrant,
});
assert.equal(
  hydrateInteraction(legacySaved, null).state.aiConsent,
  'declined',
  'hydrating legacy consent must require a new explicit context consent',
);

let realPilotState = grantAiContextConsent(createInitialInteractionState('2026-09-10T09:20:00.000Z'), '2026-09-10T09:20:01.000Z');
const realPilotRequest = beginAiRequest(
  realPilotState,
  'Câu đã gửi thật.',
  'request-real',
  '2026-09-10T09:20:10.000Z',
  '2026-09-10T09:22:10.000Z',
);
realPilotState = applyAiResponse(
  realPilotRequest.state,
  'request-real',
  realPilotRequest.sequence,
  'Phản hồi thật từ AI bên ngoài.',
  '2026-09-10T09:20:11.000Z',
);
assert.equal(realPilotState.messages.at(-1)?.provenance, 'AI_EXTERNAL');
const stoppedAndSaved = serializeInteraction(updateAiConsent(realPilotState, 'declined', '2026-09-10T09:21:00.000Z'));
assert.equal(
  getAiSendingStatus(hydrateInteraction(stoppedAndSaved, null).state),
  'stopped',
  're-entering after an external response must preserve the stopped status',
);

const withGoal = setUserGoal(corrected, 'Chuẩn bị cho ca mổ của mẹ', 'Viết ba câu hỏi cần hỏi bác sĩ', '2026-09-10T08:06:00.000Z');
assert.equal(withGoal.goal?.authoredBy, 'user');
assert.equal(withGoal.goal?.action, 'Viết ba câu hỏi cần hỏi bác sĩ');

const saved = serializeInteraction(withGoal);
assert.deepEqual(hydrateInteraction(saved, null), { kind: 'ok', state: withGoal });
assert.equal(hydrateInteraction('not-json', null).kind, 'unreadable');
assert.equal(
  hydrateInteraction(saved, '2026-09-10T08:07:00.000Z').kind,
  'deleted',
  'deletion tombstone must prevent an older snapshot from returning',
);

const declined = updateAiConsent(withGoal, 'declined', '2026-09-10T08:08:00.000Z');
assert.equal(declined.pendingRequest, null);
assert.equal(
  applyAiResponse(
    { ...declined, pendingRequest: { requestId: 'request-new', sequence: 9, createdAt: now, expiresAt: '2026-09-10T09:00:00.000Z' } },
    'request-new',
    9,
    'must not apply',
    '2026-09-10T08:09:00.000Z',
  ).messages.length,
  declined.messages.length,
  'revoked consent must block a waiting response',
);

console.log('blank input and no forced classification: PASS');
console.log('user-authored goal/action and honest completion state: PASS');
console.log('correction, consent revocation, and stale response rejection: PASS');
console.log('unreadable preservation and deletion tombstone: PASS');
console.log('short consent-bounded AI conversation window: PASS');
console.log('consent sending-status notices: PASS');