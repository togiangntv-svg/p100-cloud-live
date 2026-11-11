import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View, Platform } from 'react-native';
import { ActionButton, Card, SectionLabel, styles as ui, BrandLogo } from '@/components/UI';
import { useColors } from '@/hooks/useColors';
import { useCoaching } from '@/context/CoachingContext';
import { useLocale } from '@/context/LocalizationContext';
import { DomainPath, WorkContext, MovementContext, RelContext, getCreativeFeedback, CoachingState } from '@/domain/coaching';

function getInferredLabel(path: DomainPath | null, ctx: string | null, isEn: boolean) {
  if (path === 'work') {
    if (ctx === 'job_seeking') return isEn ? 'Work - Job seeking' : 'Công việc - Tìm việc';
    if (ctx === 'selling') return isEn ? 'Work - Selling/Clients' : 'Công việc - Bán hàng / Khách hàng';
    if (ctx === 'no_task_today') return isEn ? 'Work - No specific task today' : 'Công việc - Chưa có việc cụ thể hôm nay';
    if (ctx === 'overloaded') return isEn ? 'Work - Overloaded' : 'Công việc - Quá tải';
    if (ctx === 'ineffective') return isEn ? 'Work - Ineffective' : 'Công việc - Chưa hiệu quả';
    return isEn ? 'Work' : 'Công việc';
  }
  if (path === 'movement') {
    if (ctx === 'no_plan') return isEn ? 'Movement - No plan yet' : 'Vận động - Chưa có kế hoạch';
    if (ctx === 'busy') return isEn ? 'Movement - Busy' : 'Vận động - Quá bận rộn';
    if (ctx === 'physical_limitation') return isEn ? 'Movement - Physical limitation' : 'Vận động - Hạn chế thể chất';
    return isEn ? 'Movement' : 'Vận động';
  }
  if (path === 'relationships') {
    if (ctx === 'children') return isEn ? 'Relationships - Children' : 'Mối quan hệ - Con cái';
    if (ctx === 'parents') return isEn ? 'Relationships - Parents' : 'Mối quan hệ - Cha mẹ';
    if (ctx === 'friends') return isEn ? 'Relationships - Friends' : 'Mối quan hệ - Bạn bè';
    if (ctx === 'colleagues') return isEn ? 'Relationships - Colleagues' : 'Mối quan hệ - Đồng nghiệp';
    if (ctx === 'partner') return isEn ? 'Relationships - Partner' : 'Mối quan hệ - Người đồng hành';
    if (ctx === 'unspecified') return isEn ? 'Relationships - Not specified' : 'Mối quan hệ - Chưa muốn nói rõ';
    return isEn ? 'Relationships' : 'Mối quan hệ';
  }
  if (path === 'creativity') return isEn ? 'Creativity' : 'Sáng tạo';
  if (path === 'learning') return isEn ? 'Learning / Curiosity' : 'Học hỏi / Tò mò';
  if (path === 'joy') return isEn ? 'Joy' : 'Niềm vui';
  if (path === 'other') return isEn ? 'Other topic' : 'Chủ đề khác';
  return '';
}

function getStandardDomainData(state: CoachingState, isEn: boolean) {
  let understanding = '';
  let practices: string[] = [];
  
  if (state.path === 'work') {
    if (state.workContext === 'job_seeking') {
      understanding = isEn ? "I understand you are looking for new work opportunities." : "Tôi đang hiểu bạn đang tìm kiếm cơ hội công việc mới.";
      practices = [
        isEn ? "Update CV for 15 mins" : "Cập nhật CV trong 15 phút",
        isEn ? "Reach out to a connection" : "Nhắn tin cho một người quen",
        isEn ? "Take a full day off from searching" : "Nghỉ ngơi hoàn toàn 1 ngày không tìm việc"
      ];
    } else if (state.workContext === 'selling') {
      understanding = isEn ? "I understand you are facing pressure with sales or clients." : "Tôi đang hiểu bạn gặp áp lực về doanh số hoặc khách hàng.";
      practices = [
        isEn ? "Review one client case" : "Rà soát lại một trường hợp khách hàng",
        isEn ? "Step away for 10 mins" : "Tách khỏi công việc 10 phút"
      ];
    } else if (state.workContext === 'no_task_today') {
      understanding = isEn ? "I understand there may be no specific paid task or customer work to do today." : "Tôi đang hiểu hôm nay bạn chưa có việc cụ thể, nhưng chưa biết đó là thiếu khách, đang chờ việc hay chủ động nghỉ.";
      practices = [
        isEn ? "Clarify what 'no work today' means for you" : "Làm rõ “chưa có việc” là thiếu khách, chờ việc hay đang nghỉ",
        isEn ? "Choose one useful preparation for later" : "Chọn một việc chuẩn bị có ích cho lúc có việc",
        isEn ? "Use the free time for recovery" : "Dùng khoảng trống này để nghỉ và hồi phục"
      ];
    } else if (state.workContext === 'overloaded') {
      understanding = isEn ? "I understand you have too much on your plate." : "Tôi đang hiểu bạn có quá nhiều việc.";
      practices = [
        isEn ? "Delegate or drop one small task" : "Bỏ bớt hoặc giao lại một việc nhỏ",
        isEn ? "Block 30 mins of no-interruption time" : "Chặn 30 phút không ai làm phiền"
      ];
    } else if (state.workContext === 'ineffective') {
      understanding = isEn ? "I understand you feel your work isn't effective right now." : "Tôi đang hiểu bạn cảm thấy làm việc chưa hiệu quả lúc này.";
      practices = [
        isEn ? "Clarify the single most important task" : "Làm rõ đúng một việc quan trọng nhất",
        isEn ? "Change environment" : "Đổi không gian làm việc"
      ];
    }
  } else if (state.path === 'movement') {
    if (state.movementContext === 'no_plan') {
      understanding = isEn ? "I understand you want to move more but do not have a plan that fits yet." : "Tôi đang hiểu bạn muốn vận động nhưng chưa có cách nào thật sự hợp với đời sống của mình.";
      practices = [
        isEn ? "Notice one time and place where movement could fit" : "Quan sát một thời điểm và nơi vận động có thể chen vào tự nhiên",
        isEn ? "Choose a kind of movement you would actually enjoy" : "Chọn kiểu vận động bạn thật sự muốn thử"
      ];
    } else if (state.movementContext === 'busy') {
      understanding = isEn ? "I understand you are very busy." : "Tôi hiểu bạn đang rất bận rộn.";
      practices = [
        isEn ? "Find one transition in your day where movement can replace waiting" : "Tìm một khoảng chuyển trong ngày có thể vận động thay vì chờ",
        isEn ? "Choose a shorter form that fits your actual shift or family rhythm" : "Chọn cách ngắn hơn, hợp ca làm hoặc nhịp gia đình của bạn"
      ];
    } else if (state.movementContext === 'physical_limitation') {
      understanding = isEn ? "I understand you have a physical limitation right now. 100 does not give medical diagnoses, please listen to your body." : "Tôi hiểu bạn đang có hạn chế về thể chất. 100 không đưa ra chẩn đoán y tế, hãy lắng nghe cơ thể mình.";
      practices = [
        isEn ? "Rest and note what your body is telling you" : "Nghỉ và ghi nhận điều cơ thể đang báo",
        isEn ? "If safe for you, choose only a familiar gentle movement" : "Nếu thấy an toàn, chỉ chọn vận động nhẹ mà bạn đã quen",
        isEn ? "Seek qualified advice if the limitation is new or concerning" : "Tìm người có chuyên môn nếu hạn chế này mới xuất hiện hoặc đáng lo"
      ];
    }
  } else if (state.path === 'relationships') {
    const relName = state.relContext === 'children' ? (isEn ? 'your children' : 'con cái') :
                    state.relContext === 'parents' ? (isEn ? 'your parents' : 'cha mẹ') :
                    state.relContext === 'friends' ? (isEn ? 'your friends' : 'bạn bè') :
                    state.relContext === 'colleagues' ? (isEn ? 'your colleagues' : 'đồng nghiệp') :
                    state.relContext === 'partner' ? (isEn ? 'your partner' : 'người đồng hành') :
                    (isEn ? 'a relationship you have not named' : 'một mối quan hệ bạn chưa muốn nói rõ');
    understanding = isEn ? `I understand you are thinking about your relationship with ${relName}.` : `Tôi đang hiểu bạn đang suy nghĩ về mối quan hệ với ${relName}.`;
    practices = [
      isEn ? "Tell 100 what feels hardest or most important here" : "Kể thêm điều khó nhất hoặc quan trọng nhất với bạn lúc này",
      isEn ? "Recall the last moment that felt easier between you" : "Nhìn lại lần gần nhất hai bên thấy dễ gần nhau hơn",
      isEn ? "Choose whether you want listening, clarity, or a next action" : "Chọn xem bạn cần được lắng nghe, làm rõ hay tìm một hành động tiếp theo"
    ];
  } else if (state.path === 'learning') {
    understanding = isEn ? "I understand you want to learn or explore something new." : "Tôi đang hiểu bạn muốn học hoặc khám phá một điều mới.";
    practices = [
      isEn ? "Name the question you most want answered" : "Gọi tên câu hỏi bạn muốn hiểu nhất",
      isEn ? "Explain what you already know in your own words" : "Tự nói lại điều bạn đã biết bằng lời của mình",
      isEn ? "Try one example and notice where you get stuck" : "Thử một ví dụ và quan sát chỗ mình còn vướng"
    ];
  } else if (state.path === 'joy') {
    understanding = isEn ? "I understand something is bringing you joy. It does not need to become a problem to solve." : "Tôi đang hiểu có điều làm bạn vui. Niềm vui này không cần bị biến thành một vấn đề để giải quyết.";
    practices = [
      isEn ? "Stay with the moment and notice what makes it meaningful" : "Ở lại với khoảnh khắc và nhận ra điều làm nó có ý nghĩa",
      isEn ? "Choose whether to keep it private or share it" : "Tự chọn giữ riêng hay chia sẻ niềm vui này",
      isEn ? "Let the joy point toward something you want to explore" : "Để niềm vui gợi ra điều bạn muốn khám phá tiếp"
    ];
  } else {
    understanding = isEn ? "I know only that you want to begin somewhere else; you can name the direction yourself." : "Tôi chỉ biết bạn muốn bắt đầu từ chuyện khác; bạn có thể tự gọi tên hướng đi.";
    practices = [
      isEn ? "Take a small next step" : "Chọn một bước nhỏ tiếp theo",
      isEn ? "Pause and step back" : "Tạm dừng và lùi lại một bước"
    ];
  }
  
  return { understanding, practices };
}

export function CoachingExperience() {
  const coaching = useCoaching();
  return <CoachingEditor key={coaching.projectionRevision} />;
}

function CoachingEditor() {
  const colors = useColors();
  const coaching = useCoaching();
  const { localeCode } = useLocale();
  const { state } = coaching;
  const isEn = localeCode === 'en-US';
  
  const [inputText, setInputText] = useState('');
  
  const handleStart = () => {
    coaching.startStory(inputText);
    setInputText('');
  };
  
  const handleCreativeDetail = () => {
    coaching.submitCreativeDetail(inputText);
    setInputText('');
  };
  
  const handleCreativeInterp = () => {
    coaching.submitCreativeInterpretation(inputText);
    setInputText('');
  };

  const textInputStyle = [
    styles.input, 
    { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }
  ];

  if (state.status === 'idle') {
    return (
      <View style={styles.start}>
        <View style={styles.startBrand}>
          <BrandLogo size={48} />
          <View style={[styles.startBrandRule, { backgroundColor: colors.brandGold }]} />
        </View>
        <Text style={[styles.greeting, { color: colors.foreground }]}>{isEn ? "Hello." : "Chào bạn."}</Text>
        <Text style={[styles.startQuestion, { color: colors.foreground }]}>{isEn ? "Where would you like to begin today?" : "Hôm nay, bạn muốn bắt đầu từ chuyện gì?"}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginTop: 4 }]}>{isEn ? "Tell it in your own words, or choose a suggestion." : "Bạn có thể kể bằng lời của mình, hoặc chọn một gợi ý."}</Text>
        
        <TextInput
          style={textInputStyle}
          multiline
          maxLength={500}
          placeholder={isEn ? "Tell 100 what matters to you now..." : "Kể điều đang quan trọng với bạn lúc này..."}
          placeholderTextColor={colors.mutedForeground}
          value={inputText}
          onChangeText={setInputText}
          testID="coaching-story-input"
          accessibilityLabel={isEn ? "Story input" : "Nội dung câu chuyện"}
        />
        
        <ActionButton label={inputText.trim() ? (isEn ? "Continue" : "Tiếp tục") : (isEn ? "I want to choose" : "Tôi muốn tự chọn")} onPress={handleStart} testID="coaching-story-submit" />
      </View>
    );
  }

  if (state.status === 'correction') {
    const inferredLabel = getInferredLabel(state.path, state.workContext || state.movementContext || state.relContext, isEn);
    return (
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>{isEn ? "My understanding" : "Góc nhìn của 100"}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginVertical: 8 }]}>
          {isEn ? `I understand you might be focusing on: ` : `Có thể bạn đang quan tâm tới: `}
          <Text style={{ fontWeight: '700', color: colors.primary }}>[{inferredLabel}]</Text>
        </Text>
        <Text style={[ui.subtitle, { color: colors.foreground, marginBottom: 16 }]}>{isEn ? "Is this correct?" : "Điều này có đúng với bạn không?"}</Text>
        
        <ActionButton label={isEn ? "Yes, continue" : "Đúng, tiếp tục"} onPress={coaching.acceptCorrection} testID="coaching-correction-submit" />
        <ActionButton label={isEn ? "No, let me choose" : "Không, để tôi chọn lại"} onPress={coaching.changeDirection} secondary icon="edit-2" testID="coaching-correction-edit" />
      </Card>
    );
  }

  if (state.status === 'domain_select') {
    return (
      <>
        <SectionLabel>{isEn ? "Choose your direction" : "Chọn hướng bạn muốn đi tiếp"}</SectionLabel>
        <Card>
          <ActionButton label={isEn ? "Work" : "Công việc"} onPress={() => coaching.selectPath('work')} secondary testID="domain-work" />
          <ActionButton label={isEn ? "Movement" : "Vận động"} onPress={() => coaching.selectPath('movement')} secondary testID="domain-movement" />
          <ActionButton label={isEn ? "Relationships" : "Mối quan hệ"} onPress={() => coaching.selectPath('relationships')} secondary testID="domain-relationships" />
          <ActionButton label={isEn ? "Creativity" : "Sáng tạo"} onPress={() => coaching.selectPath('creativity')} secondary testID="domain-creativity" />
          <ActionButton label={isEn ? "Learning / Curiosity" : "Học hỏi / Tò mò"} onPress={() => coaching.selectPath('learning')} secondary testID="domain-learning" />
          <ActionButton label={isEn ? "Joy" : "Niềm vui"} onPress={() => coaching.selectPath('joy')} secondary testID="domain-joy" />
          <ActionButton label={isEn ? "Other" : "Chủ đề khác"} onPress={() => coaching.selectPath('other')} secondary testID="domain-other" />
        </Card>
      </>
    );
  }

  if (state.status === 'subdomain_select') {
    if (state.path === 'work') {
      return (
        <Card>
          <Text style={[styles.title, { color: colors.foreground, marginBottom: 12 }]}>{isEn ? "What about work?" : "Về công việc, bạn đang tập trung vào điều gì?"}</Text>
          <ActionButton label={isEn ? "Job seeking" : "Tìm việc"} onPress={() => coaching.selectWorkContext('job_seeking')} secondary testID="sub-work-job" />
          <ActionButton label={isEn ? "Selling / Clients" : "Bán hàng / Khách hàng"} onPress={() => coaching.selectWorkContext('selling')} secondary testID="sub-work-sell" />
          <ActionButton label={isEn ? "No specific work today" : "Chưa có việc cụ thể hôm nay"} onPress={() => coaching.selectWorkContext('no_task_today')} secondary testID="sub-work-no-task" />
          <ActionButton label={isEn ? "Overloaded" : "Đang quá tải"} onPress={() => coaching.selectWorkContext('overloaded')} secondary testID="sub-work-overload" />
          <ActionButton label={isEn ? "Ineffective work" : "Làm việc chưa hiệu quả"} onPress={() => coaching.selectWorkContext('ineffective')} secondary testID="sub-work-ineffective" />
          <ActionButton label={isEn ? "Back" : "Quay lại"} onPress={() => coaching.update({ status: 'domain_select' })} secondary icon="arrow-left" />
        </Card>
      );
    }
    if (state.path === 'movement') {
      return (
        <Card>
          <Text style={[styles.title, { color: colors.foreground, marginBottom: 12 }]}>{isEn ? "What affects your movement?" : "Điều gì đang ảnh hưởng đến vận động của bạn?"}</Text>
          <ActionButton label={isEn ? "No suitable plan yet" : "Chưa có kế hoạch phù hợp"} onPress={() => coaching.selectMovementContext('no_plan')} secondary testID="sub-move-no-plan" />
          <ActionButton label={isEn ? "Too busy" : "Quá bận rộn"} onPress={() => coaching.selectMovementContext('busy')} secondary testID="sub-move-busy" />
          <ActionButton label={isEn ? "Physical limitations" : "Hạn chế thể chất (đau, mệt, yếu)"} onPress={() => coaching.selectMovementContext('physical_limitation')} secondary testID="sub-move-physical" />
          <ActionButton label={isEn ? "Back" : "Quay lại"} onPress={() => coaching.update({ status: 'domain_select' })} secondary icon="arrow-left" />
        </Card>
      );
    }
    if (state.path === 'relationships') {
      return (
        <Card>
          <Text style={[styles.title, { color: colors.foreground, marginBottom: 12 }]}>{isEn ? "Which relationship?" : "Mối quan hệ nào bạn đang nghĩ tới?"}</Text>
          <ActionButton label={isEn ? "Children" : "Con cái"} onPress={() => coaching.selectRelContext('children')} secondary testID="sub-rel-children" />
          <ActionButton label={isEn ? "Parents" : "Cha mẹ"} onPress={() => coaching.selectRelContext('parents')} secondary testID="sub-rel-parents" />
          <ActionButton label={isEn ? "Friends" : "Bạn bè"} onPress={() => coaching.selectRelContext('friends')} secondary testID="sub-rel-friends" />
          <ActionButton label={isEn ? "Colleagues" : "Đồng nghiệp"} onPress={() => coaching.selectRelContext('colleagues')} secondary testID="sub-rel-colleagues" />
          <ActionButton label={isEn ? "Partner" : "Người đồng hành"} onPress={() => coaching.selectRelContext('partner')} secondary testID="sub-rel-partner" />
          <ActionButton label={isEn ? "I do not want to specify yet" : "Tôi chưa muốn nói rõ"} onPress={() => coaching.selectRelContext('unspecified')} secondary testID="sub-rel-unspecified" />
          <ActionButton label={isEn ? "Back" : "Quay lại"} onPress={() => coaching.update({ status: 'domain_select' })} secondary icon="arrow-left" />
        </Card>
      );
    }
  }
  
  if (state.status === 'standard_reflection') {
    const { understanding, practices } = getStandardDomainData(state, isEn);
    return (
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>{isEn ? "My understanding" : "Góc nhìn của 100"}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginVertical: 12 }]}>
          {understanding}
        </Text>
        <SectionLabel>{isEn ? "Practice options" : "Lựa chọn thực hành"}</SectionLabel>
        {practices.map((p, idx) => (
          <ActionButton key={idx} label={p} onPress={() => coaching.selectStandardPractice(p)} secondary testID={`std-prac-${idx}`} />
        ))}
        <TextInput
          style={[textInputStyle, { minHeight: 60 }]}
          maxLength={160}
          placeholder={isEn ? "Or choose your own practical step..." : "Hoặc tự chọn một việc vừa sức với bạn..."}
          placeholderTextColor={colors.mutedForeground}
          value={inputText}
          onChangeText={setInputText}
          accessibilityLabel={isEn ? "Your own practice" : "Cách thực hành của bạn"}
          testID="standard-practice-custom-input"
        />
        <ActionButton
          label={isEn ? "Use my choice" : "Dùng lựa chọn của tôi"}
          onPress={() => { coaching.selectStandardPractice(inputText.trim()); setInputText(''); }}
          disabled={!inputText.trim()}
          secondary
          testID="standard-practice-custom-submit"
        />
        <ActionButton label={isEn ? "You misunderstood me" : "Bạn hiểu sai ý tôi"} onPress={coaching.changeDirection} secondary icon="rotate-ccw" testID="misunderstood-btn" />
      </Card>
    );
  }

  if (state.status === 'creative_detail') {
    return (
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>{isEn ? "Note a detail" : "Ghi lại một chi tiết"}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginVertical: 8 }]}>{isEn ? "Tell me about a detail you just noticed in your life." : "Hãy kể về một chi tiết trong cuộc sống mà bạn vừa chú ý tới."}</Text>
        
        <TextInput
          style={textInputStyle}
          multiline
          maxLength={500}
          placeholder={isEn ? "Example: Sunlight through the leaves..." : "Ví dụ: Ánh nắng chiều chiếu qua kẽ lá..."}
          placeholderTextColor={colors.mutedForeground}
          value={inputText}
          onChangeText={setInputText}
          testID="creative-detail-input"
          accessibilityLabel={isEn ? "Detail input" : "Nhập chi tiết"}
        />
        <ActionButton label={isEn ? "Continue" : "Tiếp tục"} onPress={handleCreativeDetail} disabled={!inputText.trim()} testID="creative-detail-submit" />
      </Card>
    );
  }

  if (state.status === 'creative_interpretation') {
    return (
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>{isEn ? "Your perspective" : "Góc nhìn của bạn"}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginVertical: 8 }]}>{isEn ? "What does that detail mean or feel like to you?" : "Chi tiết đó mang lại cho bạn cảm giác gì hay ý nghĩa gì?"}</Text>
        <TextInput
          style={textInputStyle}
          multiline
          maxLength={500}
          placeholder={isEn ? "Example: A sense of peace..." : "Ví dụ: Cảm giác bình yên..."}
          placeholderTextColor={colors.mutedForeground}
          value={inputText}
          onChangeText={setInputText}
          testID="creative-interp-input"
          accessibilityLabel={isEn ? "Interpretation input" : "Nhập góc nhìn"}
        />
        <ActionButton label={isEn ? "Continue" : "Tiếp tục"} onPress={handleCreativeInterp} disabled={!inputText.trim()} testID="creative-interp-submit" />
      </Card>
    );
  }

  if (state.status === 'creative_direction') {
    return (
      <Card>
        <Text style={[styles.title, { color: colors.foreground, marginBottom: 12 }]}>{isEn ? "How do you want to develop this?" : "Bạn muốn phát triển chi tiết này theo hướng nào?"}</Text>
        <ActionButton label={isEn ? "Write a story" : "Viết thành câu chuyện"} onPress={() => coaching.submitCreativeDirection('story')} secondary testID="creative-dir-story" />
        <ActionButton label={isEn ? "Write a poem" : "Làm thơ"} onPress={() => coaching.submitCreativeDirection('poem')} secondary testID="creative-dir-poem" />
        <ActionButton label={isEn ? "Create art" : "Vẽ / Hình ảnh"} onPress={() => coaching.submitCreativeDirection('art')} secondary testID="creative-dir-art" />
        <View style={{ marginTop: 12 }}>
          <TextInput
            style={[textInputStyle, { minHeight: 60 }]}
            maxLength={100}
            placeholder={isEn ? "Or enter your own direction..." : "Hoặc nhập một hướng đi khác..."}
            placeholderTextColor={colors.mutedForeground}
            value={inputText}
            onChangeText={setInputText}
            testID="creative-custom-dir"
            accessibilityLabel={isEn ? "Custom direction" : "Hướng đi khác"}
          />
          <ActionButton label={isEn ? "Use custom direction" : "Dùng hướng đi này"} onPress={() => { if(inputText.trim()) coaching.submitCreativeDirection(`custom: ${inputText}`); setInputText(''); }} disabled={!inputText.trim()} secondary testID="creative-dir-custom" />
        </View>
      </Card>
    );
  }

  if (state.status === 'creative_feedback') {
    const feedback = getCreativeFeedback(state.creativeDetail, state.creativeInterpretation, state.creativeDirection);
    return (
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>{isEn ? "Creative support" : "Đồng hành sáng tạo"}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginVertical: 12 }]}>
          {isEn ? `Observation: ${feedback.observation}\nMeaning: ${feedback.meaning}\nDirection: ${feedback.direction}\n\n100 will not write it for you. This is your creation.` : `Chi tiết: ${feedback.observation}\nÝ nghĩa: ${feedback.meaning}\nHướng đi: ${feedback.direction}\n\n100 sẽ không làm thay bạn. Đây là tác phẩm của bạn.`}
        </Text>
        
        {state.isExampleRequested && !state.lowSupport ? (
          <View style={{ padding: 12, backgroundColor: colors.secondary, borderRadius: 8, marginBottom: 12 }}>
            <Text style={{ color: colors.foreground, fontSize: 13 }}>
              {isEn ? "Example: If someone noticed 'rain on the window', and felt 'cozy', they might write a short paragraph focusing only on the sound, without judging it." : "Ví dụ nhỏ: Nếu một người chú ý 'mưa trên cửa kính' và thấy 'ấm áp', họ có thể viết một đoạn ngắn tả âm thanh đó mà không cần đánh giá đúng sai."}
            </Text>
          </View>
        ) : null}

        <SectionLabel>{isEn ? "Practice" : "Thực hành"}</SectionLabel>
        {!state.isExampleRequested && !state.lowSupport ? <ActionButton label={isEn ? "Show an example (not using my material)" : "Xem một ví dụ nhỏ (không dùng chất liệu của tôi)"} onPress={coaching.requestExample} secondary testID="creative-example" /> : null}
        <ActionButton
          label={state.lowSupport ? (isEn ? "Show support again" : "Hiện lại gợi ý khi cần") : (isEn ? "Let me try with less help" : "Để tôi tự thử với ít gợi ý")}
          onPress={() => coaching.update({ lowSupport: !state.lowSupport })}
          secondary
          testID="creative-low-support"
        />
        <ActionButton label={isEn ? "I will try it now" : "Tôi sẽ thử ngay"} onPress={() => coaching.selectCreativePractice('do_now')} testID="creative-prac-now" />
        <TextInput
          style={[textInputStyle, { minHeight: 60, marginTop: 12 }]}
          maxLength={100}
          placeholder={isEn ? "Or propose alternate practice..." : "Hoặc đề xuất cách làm khác..."}
          placeholderTextColor={colors.mutedForeground}
          value={inputText}
          onChangeText={setInputText}
          testID="creative-prac-alt"
          accessibilityLabel={isEn ? "Alternate practice" : "Thực hành khác"}
        />
        <ActionButton label={isEn ? "Use alternate practice" : "Dùng cách này"} onPress={() => { if(inputText.trim()) { coaching.selectCreativePractice(inputText); setInputText(''); } }} disabled={!inputText.trim()} secondary testID="creative-prac-custom" />
        <ActionButton label={isEn ? "You misunderstood me" : "Bạn hiểu sai ý tôi"} onPress={coaching.changeDirection} secondary icon="rotate-ccw" />
      </Card>
    );
  }

  if (state.status === 'creative_practice' || state.status === 'standard_practice') {
    const isCreative = state.status === 'creative_practice';
    return (
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>{isEn ? 'Practicing' : 'Đang thực hành'}</Text>
        <Text style={[ui.subtitle, { color: colors.primary, marginTop: 8 }]}>
          {isCreative ? state.creativePractice : state.standardPractice}
        </Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginVertical: 12 }]}>
          {isEn ? "Once you have tried, return here to record your findings. 100 will not assume your progress." : "Khi bạn đã thử một nhịp nghiệm, hãy quay lại đây để ghi chép lại kết quả. 100 sẽ không tự đánh giá bạn có tiến bộ hay không."}
        </Text>
        <ActionButton label={isEn ? "I'm done / Return" : "Tôi đã làm xong / Quay lại"} onPress={isCreative ? coaching.returnFromPractice : coaching.returnFromStandardPractice} icon="check" testID="practice-return" />
        <ActionButton label={isEn ? "Pause" : "Tạm dừng"} onPress={coaching.pause} secondary testID="practice-pause" />
        <ActionButton label={isEn ? "You misunderstood me" : "Bạn hiểu sai ý tôi"} onPress={coaching.changeDirection} secondary icon="rotate-ccw" testID="practice-misunderstood" />
        <ActionButton label={isEn ? "Change direction" : "Chuyển hướng khác"} onPress={coaching.skip} secondary testID="practice-skip" />
        <ActionButton label={isEn ? "Stop (finish early)" : "Dừng phiên (hoàn tất sớm)"} onPress={coaching.stop} secondary icon="x-circle" testID="practice-stop" />
      </Card>
    );
  }

  if (state.status === 'creative_return' || state.status === 'standard_return') {
    const isCreative = state.status === 'creative_return';
    const handleSubmit = () => {
      if (isCreative) coaching.submitCreativeReturn(inputText, false);
      else coaching.submitStandardReturn(inputText, false);
      setInputText('');
    };
    const handleDidNotDo = () => {
      if (isCreative) coaching.submitCreativeReturn("", true);
      else coaching.submitStandardReturn("", true);
      setInputText('');
    };

    const returnPrompt = isCreative
      ? (isEn ? 'What did you make or notice?' : 'Bạn đã tạo ra điều gì hoặc nhận thấy điều gì?')
      : state.path === 'movement'
        ? (isEn ? 'How did your body and daily rhythm respond?' : 'Cơ thể và nhịp sống của bạn phản hồi thế nào?')
        : state.path === 'relationships'
          ? (isEn ? 'What did you notice, choose, or hear in this relationship?' : 'Bạn đã quan sát, lựa chọn hoặc nghe được điều gì trong mối quan hệ này?')
          : state.path === 'work'
            ? (isEn ? 'What did you try, and what actually happened?' : 'Bạn đã thử điều gì, và thực tế đã xảy ra thế nào?')
            : state.path === 'learning'
              ? (isEn ? 'What can you now explain, and what remains unclear?' : 'Điều gì bạn đã tự giải thích được, và điều gì còn chưa rõ?')
              : state.path === 'joy'
                ? (isEn ? 'What did you notice by staying with this joy?' : 'Khi ở lại với niềm vui này, bạn nhận ra điều gì?')
                : (isEn ? 'What happened when you tried your choice?' : 'Điều gì xảy ra khi bạn thử lựa chọn của mình?');

    return (
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>{isEn ? "Record your return" : "Ghi nhận sau thực hành"}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginVertical: 8 }]}>{returnPrompt}</Text>
        <TextInput
          style={textInputStyle}
          multiline
          maxLength={500}
          placeholder={isEn ? "Example: I wrote a few lines..." : "Ví dụ: Tôi đã viết được vài dòng..."}
          placeholderTextColor={colors.mutedForeground}
          value={inputText}
          onChangeText={setInputText}
          testID="return-material-input"
          accessibilityLabel={isEn ? "Return material" : "Ghi nhận thực hành"}
        />
        <ActionButton label={isEn ? "Complete record" : "Hoàn tất ghi nhận"} onPress={handleSubmit} disabled={!inputText.trim()} testID="return-material-submit" />
        <ActionButton label={isEn ? "I did not do it" : "Tôi chưa làm / Không làm"} onPress={handleDidNotDo} secondary testID="return-did-not-do" />
      </Card>
    );
  }

  if (state.status === 'next_training' || state.status === 'completed') {
    const isCreativeResult = state.status === 'next_training' || state.completionKind === 'creative';
    const didNotDoIt = isCreativeResult ? state.creativeDidNotDoIt : state.standardDidNotDoIt;
    const material = isCreativeResult ? state.creativeReturnMaterial : state.standardReturnMaterial;
    const stopped = state.completionKind === 'stopped';
    
    return (
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>{stopped ? (isEn ? "Session stopped" : "Đã dừng phiên") : (isEn ? "Recorded" : "Đã ghi nhận")}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginVertical: 8 }]}>
          {stopped
            ? (isEn ? "100 has kept only what you allowed to be saved. You can return or begin elsewhere later." : "100 chỉ giữ phần bạn đã cho phép lưu. Khi muốn, bạn có thể quay lại hoặc bắt đầu hướng khác.")
            : didNotDoIt
            ? (isEn ? "Noted: You did not do it. That is valid information." : "Ghi nhận: Bạn chưa thực hiện. Đó cũng là một thông tin hợp lệ.")
            : material ? (isEn ? `Thank you for sharing: "${material}". ` : `Cảm ơn bạn đã chia sẻ: "${material}". `) : ''}
        </Text>
        
        {state.status === 'next_training' ? (
          <>
            <Text style={[ui.subtitle, { color: colors.foreground, marginVertical: 12 }]}>{isEn ? "This practice loop is complete. You can choose what to train next." : "Vòng thực hành này đã kết thúc. Bạn có thể chọn điều để huấn luyện tiếp theo."}</Text>
            <ActionButton label={isEn ? "Observation" : "Quan sát"} onPress={() => coaching.selectNextTraining('observation')} secondary testID="train-obs" />
            <ActionButton label={isEn ? "Perspective" : "Góc nhìn"} onPress={() => coaching.selectNextTraining('perspective')} secondary testID="train-persp" />
            <ActionButton label={isEn ? "Direction" : "Hướng đi"} onPress={() => coaching.selectNextTraining('direction')} secondary testID="train-dir" />
            <ActionButton label={isEn ? "Expression" : "Diễn đạt"} onPress={() => coaching.selectNextTraining('expression')} secondary testID="train-exp" />
            <ActionButton label={isEn ? "Rest" : "Nghỉ ngơi"} onPress={() => coaching.selectNextTraining('rest')} secondary testID="train-rest" />
            <TextInput
              style={[textInputStyle, { minHeight: 60 }]}
              maxLength={100}
              placeholder={isEn ? "Or name what you want to train..." : "Hoặc tự gọi tên điều bạn muốn rèn..."}
              placeholderTextColor={colors.mutedForeground}
              value={inputText}
              onChangeText={setInputText}
              testID="train-custom-input"
            />
            <ActionButton label={isEn ? "Use my direction" : "Dùng hướng của tôi"} onPress={() => { coaching.selectNextTraining(inputText.trim()); setInputText(''); }} disabled={!inputText.trim()} secondary testID="train-custom-submit" />
          </>
        ) : (
          <ActionButton label={isEn ? "Start a new loop" : "Bắt đầu vòng mới"} onPress={coaching.reset} icon="refresh-cw" testID="train-restart" />
        )}
      </Card>
    );
  }
  
  if (state.status === 'paused') {
    return (
      <Card>
        <Text style={[styles.title, { color: colors.foreground }]}>{isEn ? "Paused" : "Đang tạm dừng"}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginVertical: 8 }]}>
          {isEn ? "You can continue when you are ready." : "Bạn có thể tiếp tục khi sẵn sàng."}
        </Text>
        <ActionButton label={isEn ? "Continue" : "Tiếp tục"} onPress={coaching.resume} icon="play" testID="resume-btn" />
        <ActionButton label={isEn ? "Reset" : "Xóa và bắt đầu lại"} onPress={coaching.reset} secondary icon="rotate-ccw" testID="reset-btn" />
      </Card>
    );
  }

  return null;
}

const displayFont = Platform.select({ ios: 'Georgia', android: 'serif', web: 'Georgia' });

const styles = StyleSheet.create({
  start: { paddingTop: 28, paddingBottom: 8 },
  startBrand: { alignSelf: 'flex-start', marginBottom: 28 },
  startBrandRule: { width: 22, height: 2, borderRadius: 1, marginTop: 5 },
  greeting: { fontSize: 40, lineHeight: 47, fontWeight: '600', letterSpacing: -1.1, fontFamily: displayFont },
  startQuestion: { fontSize: 22, lineHeight: 30, fontWeight: '700', marginTop: 12, maxWidth: 340 },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    marginBottom: 8,
    minHeight: 120,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  title: { fontSize: 24, lineHeight: 31, fontWeight: '700' },
});
