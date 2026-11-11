import assert from 'node:assert/strict';
import {
  analyzeStory,
  getCreativeFeedback,
  hydrateCoaching,
  initialCoachingState,
  serializeCoaching,
  transitionAcceptCorrection,
  transitionChangeDirection,
  transitionCreativeDetail,
  transitionCreativeDirection,
  transitionCreativeInterpretation,
  transitionCreativeNext,
  transitionCreativePractice,
  transitionCreativeReturn,
  transitionPause,
  transitionResume,
  transitionSelectMovementContext,
  transitionSelectPath,
  transitionSelectWorkContext,
  transitionStandardPractice,
  transitionStandardReturn,
  transitionStartStory,
  transitionStop,
} from '../domain/coaching.ts';

function runTests() {
  console.log('Running Coaching Domain Tests...');

  const childStory = analyzeStory('Tôi đã lớn tuổi và buồn vì dạo này con ít gọi điện về.');
  assert.deepEqual(childStory, { inferredPath: 'relationships', inferredContext: 'children' });

  assert.deepEqual(analyzeStory('Tôi đang thất nghiệp và tìm việc rất khó.'), {
    inferredPath: 'work',
    inferredContext: 'job_seeking',
  });
  assert.deepEqual(analyzeStory('Khách chê đắt, hôm nay tôi không bán được hàng.'), {
    inferredPath: 'work',
    inferredContext: 'selling',
  });
  assert.deepEqual(analyzeStory('Hôm nay tôi chưa có việc cụ thể.'), {
    inferredPath: 'work',
    inferredContext: 'no_task_today',
  });
  assert.deepEqual(analyzeStory('Tôi bận công việc và có quá nhiều việc.'), {
    inferredPath: 'work',
    inferredContext: 'overloaded',
  });
  assert.deepEqual(analyzeStory('Cách làm hiện tại chưa hiệu quả.'), {
    inferredPath: 'work',
    inferredContext: 'ineffective',
  });

  assert.deepEqual(analyzeStory('Tôi quá bận nên không có thời gian tập.'), {
    inferredPath: 'movement',
    inferredContext: 'busy',
  });
  assert.deepEqual(analyzeStory('Tôi muốn vận động nhưng chưa có kế hoạch.'), {
    inferredPath: 'movement',
    inferredContext: 'no_plan',
  });
  assert.deepEqual(analyzeStory('Gần đây tôi bị đau lưng và thấy sức yếu.'), {
    inferredPath: 'movement',
    inferredContext: 'physical_limitation',
  });

  assert.equal(analyzeStory('Hôm nay tôi rất vui.').inferredPath, 'joy');
  assert.equal(analyzeStory('Tôi tò mò và muốn học một điều mới.').inferredPath, 'learning');
  assert.equal(analyzeStory('Tôi muốn rèn sáng tạo và tìm ý tưởng.').inferredPath, 'creativity');

  let state = transitionStartStory(initialCoachingState, 'Tôi đang tìm việc');
  assert.equal(state.status, 'correction');
  assert.equal(state.pathSource, 'inferred');
  assert.equal(transitionAcceptCorrection(state).status, 'standard_reflection');
  state = transitionChangeDirection(state);
  assert.equal(state.status, 'domain_select');
  assert.equal(state.path, null);
  assert.equal(state.workContext, null);
  assert.equal(state.freeformStory, 'Tôi đang tìm việc');
  state = transitionSelectPath(state, 'movement');
  state = transitionSelectMovementContext(state, 'physical_limitation');
  assert.equal(state.pathSource, 'chosen');
  assert.equal(state.movementContext, 'physical_limitation');
  assert.equal(state.status, 'standard_reflection');

  let creative = transitionSelectPath(initialCoachingState, 'creativity');
  creative = transitionCreativeDetail(creative, 'Ánh nắng nghiêng qua chiếc ghế trống');
  creative = transitionCreativeInterpretation(creative, 'Có thể căn phòng đang chờ một người trở lại');
  creative = transitionCreativeDirection(creative, 'Bản nhạc không lời');
  const feedback = getCreativeFeedback(
    creative.creativeDetail,
    creative.creativeInterpretation,
    creative.creativeDirection,
  );
  assert.deepEqual(feedback, {
    observation: 'Ánh nắng nghiêng qua chiếc ghế trống',
    meaning: 'Có thể căn phòng đang chờ một người trở lại',
    direction: 'Bản nhạc không lời',
  });
  creative = transitionCreativePractice(creative, 'Tự ghi ba âm thanh gợi từ chi tiết này');
  assert.equal(creative.status, 'creative_practice');
  creative = transitionCreativeReturn(creative, '', true);
  assert.equal(creative.status, 'next_training');
  assert.equal(creative.creativeDidNotDoIt, true);
  assert.equal(creative.creativeReturnMaterial, '');
  creative = transitionCreativeNext(creative, 'Tự tin chọn hướng');
  assert.equal(creative.status, 'completed');
  assert.equal(creative.completionKind, 'creative');

  let standard = transitionSelectPath(initialCoachingState, 'work');
  standard = transitionSelectWorkContext(standard, 'selling');
  standard = transitionStandardPractice(standard, 'Hỏi lại một khách điều họ thực sự cần');
  assert.equal(standard.status, 'standard_practice');
  standard = transitionStandardReturn(standard, 'Khách nói họ cần giao sớm hơn.', false);
  assert.equal(standard.status, 'completed');
  assert.equal(standard.completionKind, 'standard');
  assert.equal(standard.standardReturnMaterial, 'Khách nói họ cần giao sớm hơn.');

  let paused = transitionPause({ ...initialCoachingState, status: 'creative_direction' });
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pausedFrom, 'creative_direction');
  paused = transitionResume(paused);
  assert.equal(paused.status, 'creative_direction');
  assert.equal(paused.pausedFrom, null);
  assert.equal(transitionStop(paused).completionKind, 'stopped');

  assert.equal(hydrateCoaching('{"schemaVersion":3,"provenance":"DEMO_LOCAL","state":{"version":3,"status":"idle"}}').status, 'idle');
  assert.equal(hydrateCoaching('{"schemaVersion":3,"provenance":"DEMO_LOCAL","state":{"version":3,"status":"idle","freeformStory":7}}').status, 'idle');
  assert.equal(hydrateCoaching('not-json').status, 'idle');

  const saved = {
    ...creative,
    freeformStory: 'Tôi muốn thử một hướng sáng tạo.',
    pathSource: 'chosen',
  };
  assert.deepEqual(hydrateCoaching(serializeCoaching(saved)), saved);

  console.log('relationship/work/movement/positive scenarios: PASS');
  console.log('correction and user-chosen direction: PASS');
  console.log('creative self-authorship and honest no-result return: PASS');
  console.log('pause/resume/stop and strict DEMO_LOCAL persistence: PASS');
}

runTests();