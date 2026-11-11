import type { M3Locale } from "./m3-locales";

export type TrainerSafetyLevel = "CLEAR" | "SENSITIVE" | "PAIN" | "URGENT";
export type TrainerSafetySubject = "USER" | "OTHER" | "UNKNOWN";
export type TrainerSafetyTime = "CURRENT" | "RECENT_UNRESOLVED" | "HISTORICAL" | "UNKNOWN";
export type TrainerSafetyAssertion = "ASSERTED" | "NEGATED" | "HYPOTHETICAL" | "UNCERTAIN";
export type TrainerSafetyClarificationKind = "SUBJECT" | "CURRENT_STATUS";
export type TrainerSafetySignal =
  | "ORDINARY_EXERTION" | "MILD_POST_EXERCISE_SORENESS"
  | "ACTION_RELEVANT_PAIN" | "SUSPECTED_ACUTE_INJURY"
  | "CHEST_PAIN_OR_PRESSURE" | "FAINTING" | "NEAR_FAINTING"
  | "SEVERE_BREATHLESSNESS" | "NEW_OR_UNUSUAL_BREATHLESSNESS"
  | "SUDDEN_NEUROLOGIC_WARNING" | "PROFESSIONAL_LIMIT";

export type TrainerSafetyObservation = Readonly<{
  subject: TrainerSafetySubject;
  time: TrainerSafetyTime;
  assertion: TrainerSafetyAssertion;
  signal: TrainerSafetySignal;
  action_relevance: "RELEVANT" | "NOT_APPLICABLE" | "UNKNOWN";
  source: "USER_TEXT";
  revision: number;
  currentness: "CURRENT" | "NOT_CURRENT" | "UNCERTAIN";
}>;

export type TrainerSafetyDecision = Readonly<{
  recognition: "MATCH" | "NO_MATCH";
  knowledge: "KNOWN" | "UNKNOWN";
  level: TrainerSafetyLevel;
  authority_effect: "NONE" | "HOLD" | "STOP_RELEVANT_ACTION" | "URGENT_HELP";
  clarification: Readonly<{
    kind: TrainerSafetyClarificationKind;
    question: string;
  }> | null;
  observations: readonly TrainerSafetyObservation[];
}>;

type LocaleRules = Readonly<{
  user: RegExp;
  other: RegExp;
  hypothetical: RegExp;
  historical: RegExp;
  recent: RegExp;
  current: RegExp;
  uncertain: RegExp;
  negation: RegExp;
  signals: Readonly<Record<TrainerSafetySignal, readonly RegExp[]>>;
}>;

const emptySignals = (): Record<TrainerSafetySignal, readonly RegExp[]> => ({
  ORDINARY_EXERTION: [], MILD_POST_EXERCISE_SORENESS: [], ACTION_RELEVANT_PAIN: [],
  SUSPECTED_ACUTE_INJURY: [], CHEST_PAIN_OR_PRESSURE: [], FAINTING: [], NEAR_FAINTING: [],
  SEVERE_BREATHLESSNESS: [], NEW_OR_UNUSUAL_BREATHLESSNESS: [],
  SUDDEN_NEUROLOGIC_WARNING: [], PROFESSIONAL_LIMIT: [],
});

const makeRules = (
  context: Omit<LocaleRules, "signals">,
  signals: Partial<Record<TrainerSafetySignal, readonly RegExp[]>>,
): LocaleRules => Object.freeze({ ...context, signals: Object.freeze({ ...emptySignals(), ...signals }) });

const rules: Readonly<Record<M3Locale, LocaleRules>> = Object.freeze({
  vi: makeRules({
    user: /\b(?:toi|minh|em)\b/u,
    other: /\b(?:ban toi|nguoi ban cua toi|anh ay|co ay)\b/u,
    hypothetical: /^(?:neu|gia su)\b|\bneu .* thi sao\b/u,
    historical: /\b(?:nam ngoai|hoi nam|truoc day|tung)\b/u,
    recent: /\b(?:vua|moi vua)\b/u,
    current: /\b(?:dang|bay gio|hien tai|khi dang|luc dang)\b/u,
    uncertain: /\b(?:co le|khong chac|hinh nhu|co ve)\b/u,
    negation: /\b(?:khong|chua|khong he)\b[^,.;!?]{0,18}$/u,
  }, {
    ORDINARY_EXERTION: [/\b(?:met|tho nhanh)\b.*\b(?:sau|vi)\b.*\b(?:chay|tap)\b/u],
    MILD_POST_EXERCISE_SORENESS: [/\b(?:hoi moi|dau moi nhe|moi co)\b.*\b(?:sau buoi|hom qua|hom sau)\b/u],
    ACTION_RELEVANT_PAIN: [
      /\bdau nhoi\b.*\b(?:khi|luc)\b.*\b(?:squat|tap|di|chay|van dong)\b/u,
      /\b(?:dang di|dang tap|dang chay|dang van dong)\b.*\bdau nhoi\b/u,
    ],
    SUSPECTED_ACUTE_INJURY: [/\b(?:sung dang ke|khong chiu luc|mat chuc nang)\b/u],
    CHEST_PAIN_OR_PRESSURE: [/\b(?:dau nguc|tuc nguc|de ep o nguc)\b/u],
    FAINTING: [/\b(?:ngat|mat y thuc)\b/u],
    NEAR_FAINTING: [/\b(?:sap ngat|choang nang)\b/u],
    SEVERE_BREATHLESSNESS: [/\b(?:kho tho du doi|nghet tho|tho hon hen|kho tho den muc khong noi het cau)\b/u],
    NEW_OR_UNUSUAL_BREATHLESSNESS: [/\b(?:kho tho moi|kho tho bat thuong)\b/u],
    SUDDEN_NEUROLOGIC_WARNING: [/\b(?:yeu mot ben|te mot ben|noi kho dot ngot|kho noi dot ngot|dot nhien toi kho noi)\b/u],
    PROFESSIONAL_LIMIT: [/\b(?:bac si|chuyen gia)\b.*\b(?:han che|khong duoc|tranh)\b/u],
  }),
  en: makeRules({
    user: /\b(?:i|i'm|im|me|my)\b/u,
    other: /\b(?:my friend|my partner|he|she|they)\b/u,
    hypothetical: /^(?:what if|if|suppose)\b/u,
    historical: /\b(?:last year|years? ago|previously|used to|history of)\b/u,
    recent: /\b(?:just|recently)\b/u,
    current: /\b(?:now|currently|during|while|am having|is happening)\b/u,
    uncertain: /\b(?:maybe|might|not sure|possibly)\b/u,
    negation: /\b(?:no|not|do not|don't|did not|didn't|never)\b[^,.;!?]{0,18}$/u,
  }, {
    ORDINARY_EXERTION: [/\b(?:a little out of breath|breathing fast|tired)\b.*\b(?:after|because)\b.*\b(?:running|exercise)\b/u],
    MILD_POST_EXERCISE_SORENESS: [/\b(?:mildly sore|a little sore|muscle soreness)\b.*\b(?:after|yesterday|next day)\b/u],
    ACTION_RELEVANT_PAIN: [
      /\bsharp pain\b.*\b(?:during|when|while)\b.*\b(?:squat|exercise|walk|run|move|moving|walking|exercising)\b/u,
      /\b(?:knee|leg|shoulder|back)\b.*\b(?:hurts sharply|sharp pain)\b.*\b(?:while|when)\b/u,
    ],
    SUSPECTED_ACUTE_INJURY: [/\b(?:significant swelling|cannot bear weight|loss of function)\b/u],
    CHEST_PAIN_OR_PRESSURE: [/\b(?:chest pain|chest pressure|chest tightness|chest is tight|chest feels tight)\b/u],
    FAINTING: [/\b(?:fainted|passed out|lost consciousness)\b/u],
    NEAR_FAINTING: [/\b(?:almost faint|may pass out|near fainting)\b/u],
    SEVERE_BREATHLESSNESS: [/\b(?:severe trouble breathing|gasping|cannot (?:finish|speak) (?:a )?sentence|too short of breath to (?:finish|speak))\b/u],
    NEW_OR_UNUSUAL_BREATHLESSNESS: [
      /\b(?:new|unusual) (?:shortness of breath|breathlessness)\b/u,
      /\b(?:cannot|can't) breathe normally\b/u,
    ],
    SUDDEN_NEUROLOGIC_WARNING: [/\b(?:one-sided weakness|one side feels weak|sudden trouble speaking|suddenly have trouble speaking)\b/u],
    PROFESSIONAL_LIMIT: [/\b(?:doctor|clinician|physical therapist|physio)\b.*\b(?:limit|avoid|do not)\b/u],
  }),
  "zh-Hans": makeRules({
    user: /(?:我|我的)/u,
    other: /(?:我的朋友|我朋友|他|她)/u, hypothetical: /^(?:如果|假如)/u,
    historical: /(?:去年|以前|曾经)/u, recent: /(?:刚刚|刚才)/u,
    current: /(?:现在|正在|跑步时|运动时)/u, uncertain: /(?:可能|不确定|好像)/u,
    negation: /(?:不|没有)[^，。！？]{0,8}$/u,
  }, {
    CHEST_PAIN_OR_PRESSURE: [/(?:胸痛|胸口疼|胸口有压迫感|胸闷)/u],
    FAINTING: [/(?:晕倒|失去意识)/u], NEAR_FAINTING: [/(?:快要晕倒|差点晕倒)/u],
    SEVERE_BREATHLESSNESS: [/(?:严重呼吸困难|喘不过气|无法说完整句子)/u],
    SUDDEN_NEUROLOGIC_WARNING: [/(?:突然一侧无力|突然说话困难)/u],
    ACTION_RELEVANT_PAIN: [/(?:运动时|深蹲时).{0,8}(?:刺痛|剧痛)/u],
    SUSPECTED_ACUTE_INJURY: [/(?:明显肿胀|无法承重|失去功能)/u],
    NEW_OR_UNUSUAL_BREATHLESSNESS: [/(?:新的呼吸困难|异常呼吸困难)/u],
    PROFESSIONAL_LIMIT: [/(?:医生|专业人员).{0,12}(?:避免|限制|不应)/u],
    ORDINARY_EXERTION: [/(?:跑步后|运动后).{0,8}(?:有点累|呼吸加快)/u],
    MILD_POST_EXERCISE_SORENESS: [/(?:昨天运动后|训练后).{0,8}(?:轻微酸痛|有点酸痛)/u],
  }),
  es: makeRules({
    user: /\b(?:yo|me|mi|tengo|estoy)\b/u,
    other: /\b(?:mi amigo|mi amiga)\b/u, hypothetical: /^(?:si|que pasaria si)\b/u,
    historical: /\b(?:el ano pasado|hace anos|antes|solia)\b/u, recent: /\b(?:acabo de|recien)\b/u,
    current: /\b(?:ahora|actualmente|mientras|durante)\b/u, uncertain: /\b(?:quizas|tal vez|no estoy seguro)\b/u,
    negation: /\b(?:no|nunca)\b[^,.;!?]{0,18}$/u,
  }, {
    CHEST_PAIN_OR_PRESSURE: [/\b(?:dolor de pecho|presion en el pecho|opresion en el pecho)\b/u],
    FAINTING: [/\b(?:me desmaye|perdi el conocimiento)\b/u], NEAR_FAINTING: [/\b(?:casi me desmayo|a punto de desmayarme)\b/u],
    SEVERE_BREATHLESSNESS: [/\b(?:dificultad grave para respirar|no puedo hablar una frase completa)\b/u],
    SUDDEN_NEUROLOGIC_WARNING: [/\b(?:debilidad repentina de un lado|dificultad repentina para hablar)\b/u],
    ACTION_RELEVANT_PAIN: [/\bdolor punzante\b.*\b(?:al|mientras)\b.*\b(?:correr|caminar|entrenar|hacer sentadillas)\b/u],
    SUSPECTED_ACUTE_INJURY: [/\b(?:hinchazon importante|no puedo apoyar peso|perdida de funcion)\b/u],
    NEW_OR_UNUSUAL_BREATHLESSNESS: [/\b(?:falta de aire|dificultad para respirar)\b.*\b(?:nueva|inusual)\b/u],
    PROFESSIONAL_LIMIT: [/\b(?:medico|fisioterapeuta|profesional)\b.*\b(?:evitar|limitar|no debo)\b/u],
    ORDINARY_EXERTION: [/\b(?:cansado|respirando rapido)\b.*\b(?:despues de|por)\b.*\b(?:correr|ejercicio)\b/u],
    MILD_POST_EXERCISE_SORENESS: [/\b(?:dolor muscular leve|un poco dolorido)\b.*\b(?:despues|ayer)\b/u],
  }),
  hi: makeRules({
    user: /(?:मैं|मुझे|मेरे|मेरी|मेरा)/u,
    other: /(?:मेरा दोस्त|मेरी दोस्त|वह)/u, hypothetical: /^(?:अगर|यदि)/u,
    historical: /(?:पिछले साल|पहले|कभी हुआ था)/u, recent: /(?:अभी-अभी|हाल ही में)/u,
    current: /(?:अभी|इस समय|दौड़ते समय|व्यायाम करते समय)/u, uncertain: /(?:शायद|पक्का नहीं)/u,
    negation: /(?:नहीं)[^।,!?]{0,12}$/u,
  }, {
    CHEST_PAIN_OR_PRESSURE: [/(?:सीने में दर्द|सीने में दबाव|सीना जकड़)/u],
    FAINTING: [/(?:बेहोश हो गया|बेहोश हो गई|होश खो दिया)/u], NEAR_FAINTING: [/(?:बेहोश होने वाला|बेहोश होने वाली)/u],
    SEVERE_BREATHLESSNESS: [/(?:सांस लेने में बहुत कठिनाई|पूरा वाक्य नहीं बोल पा)/u],
    SUDDEN_NEUROLOGIC_WARNING: [/(?:एक तरफ अचानक कमजोरी|अचानक बोलने में कठिनाई)/u],
    ACTION_RELEVANT_PAIN: [/(?:दौड़ते|चलते|स्क्वाट करते).{0,16}(?:तेज दर्द|चुभता दर्द)/u],
    SUSPECTED_ACUTE_INJURY: [/(?:काफी सूजन|वजन नहीं डाल सकता|काम करने की क्षमता खो)/u],
    NEW_OR_UNUSUAL_BREATHLESSNESS: [/(?:नई|असामान्य).{0,12}(?:सांस की तकलीफ|सांस फूलना)/u],
    PROFESSIONAL_LIMIT: [/(?:डॉक्टर|विशेषज्ञ).{0,48}(?:बचना|सीमित|नहीं करना)/u],
    ORDINARY_EXERTION: [/(?:दौड़ने|व्यायाम).{0,12}(?:बाद).{0,12}(?:थका|तेज सांस)/u],
    MILD_POST_EXERCISE_SORENESS: [/(?:व्यायाम|कसरत).{0,16}(?:बाद).{0,16}(?:हल्का मांसपेशियों का दर्द|हल्की अकड़न)/u],
  }),
  ja: makeRules({
    user: /(?:私|わたし|言われ)/u,
    other: /(?:友人|友達|彼|彼女)/u, hypothetical: /^(?:もし|仮に)/u,
    historical: /(?:去年|以前|かつて)/u, recent: /(?:たった今|先ほど)/u,
    current: /(?:今|現在|走っていると|運動中)/u, uncertain: /(?:たぶん|かもしれない|よく分からない)/u,
    negation: /(?:ない|ありません)[^。！？、]{0,8}$/u,
  }, {
    CHEST_PAIN_OR_PRESSURE: [/(?:胸が痛い|胸の圧迫感|胸が締め付けられ)/u],
    FAINTING: [/(?:失神した|意識を失った)/u], NEAR_FAINTING: [/(?:失神しそう|気を失いそう)/u],
    SEVERE_BREATHLESSNESS: [/(?:ひどい息苦しさ|一文を話せないほど息苦しい)/u],
    SUDDEN_NEUROLOGIC_WARNING: [/(?:突然片側が弱い|突然言葉が出にくい)/u],
    ACTION_RELEVANT_PAIN: [/(?:スクワット|運動|歩行)中.{0,10}(?:鋭い痛み)/u],
    SUSPECTED_ACUTE_INJURY: [/(?:かなりの腫れ|体重をかけられ|機能を失)/u],
    NEW_OR_UNUSUAL_BREATHLESSNESS: [/(?:新しい|異常な).{0,8}(?:息切れ|呼吸困難)/u],
    PROFESSIONAL_LIMIT: [/(?:医師|専門家).{0,18}(?:避ける|制限|しないよう)/u],
    ORDINARY_EXERTION: [/(?:走った後|運動後).{0,10}(?:少し疲れ|呼吸が速)/u],
    MILD_POST_EXERCISE_SORENESS: [/(?:昨日の運動後|トレーニング後).{0,12}(?:軽い筋肉痛|少し筋肉痛)/u],
  }),
  ko: makeRules({
    user: /(?:나는|저는|제가|내|제)/u,
    other: /(?:내 친구|제 친구|그 사람|그녀)/u, hypothetical: /^(?:만약|가령)/u,
    historical: /(?:작년|예전에|과거에)/u, recent: /(?:방금|조금 전)/u,
    current: /(?:지금|현재|달리는 중|운동 중)/u, uncertain: /(?:아마|확실하지 않|것 같)/u,
    negation: /(?:안|않|없)[^.!?。！？,]{0,8}$/u,
  }, {
    CHEST_PAIN_OR_PRESSURE: [/(?:가슴 통증|가슴 압박감|가슴이 조여)/u],
    FAINTING: [/(?:기절했|의식을 잃었)/u], NEAR_FAINTING: [/(?:기절할 것 같|쓰러질 것 같)/u],
    SEVERE_BREATHLESSNESS: [/(?:심한 호흡 곤란|문장을 끝까지 말할 수 없)/u],
    SUDDEN_NEUROLOGIC_WARNING: [/(?:갑자기 한쪽이 약해|갑자기 말하기 어렵)/u],
    ACTION_RELEVANT_PAIN: [/(?:스쿼트|운동|걷기) 중.{0,10}(?:찌르는 통증|날카로운 통증)/u],
    SUSPECTED_ACUTE_INJURY: [/(?:심하게 붓|체중을 실을 수 없|기능을 잃)/u],
    NEW_OR_UNUSUAL_BREATHLESSNESS: [/(?:새롭고|새로운|평소와 다른).{0,12}(?:숨가쁨|호흡 곤란)/u],
    PROFESSIONAL_LIMIT: [/(?:의사|전문가).{0,18}(?:피하|제한|하지 말)/u],
    ORDINARY_EXERTION: [/(?:달리기 후|운동 후).{0,10}(?:조금 피곤|호흡이 빠)/u],
    MILD_POST_EXERCISE_SORENESS: [/(?:어제 운동 후|훈련 후).{0,12}(?:가벼운 근육통|약간의 근육통)/u],
  }),
  ru: makeRules({
    user: /(?:^|\s)(?:я|у меня|мне|мой|моя)(?:\s|$)/u,
    other: /(?:^|\s)(?:мой друг|моего друга|моя подруга|моей подруги|он|она)(?:\s|$)/u, hypothetical: /^(?:если|предположим)(?:\s|$)/u,
    historical: /(?:^|\s)(?:в прошлом году|раньше|когда-то)(?:\s|$)/u, recent: /(?:^|\s)(?:только что|недавно)(?:\s|$)/u,
    current: /(?:^|\s)(?:сейчас|в данный момент|во время|пока)(?:\s|$)/u, uncertain: /(?:^|\s)(?:возможно|может быть|не уверен)(?:\s|$)/u,
    negation: /(?:^|\s)(?:не|нет|никогда)(?:\s|$)[^,.;!?]{0,18}$/u,
  }, {
    CHEST_PAIN_OR_PRESSURE: [/(?:боль в груди|давление в груди|сдавливает грудь)/u],
    FAINTING: [/(?:потерял сознание|потеряла сознание|упал в обморок|упала в обморок)/u],
    NEAR_FAINTING: [/(?:чуть не упал в обморок|чуть не упала в обморок)/u],
    SEVERE_BREATHLESSNESS: [/(?:сильная одышка|не могу закончить предложение из-за одышки)/u],
    SUDDEN_NEUROLOGIC_WARNING: [/(?:внезапная слабость с одной стороны|внезапно трудно говорить)/u],
    ACTION_RELEVANT_PAIN: [/(?:резкая боль).{0,24}(?:при беге|при ходьбе|при приседании)/u],
    SUSPECTED_ACUTE_INJURY: [/(?:значительно опухло|не могу наступать|потеря функции)/u],
    NEW_OR_UNUSUAL_BREATHLESSNESS: [/(?:новая|необычная).{0,12}(?:одышка|нехватка воздуха)/u],
    PROFESSIONAL_LIMIT: [/(?:врач|специалист).{0,24}(?:избегать|ограничить|не делать)/u],
    ORDINARY_EXERTION: [/(?:немного устал|учащенно дышу).{0,16}(?:после бега|после тренировки)/u],
    MILD_POST_EXERCISE_SORENESS: [/(?:после вчерашней тренировки|после тренировки).{0,20}(?:легкая мышечная боль|небольшая болезненность)/u],
  }),
});

const mixedCritical: Readonly<Partial<Record<TrainerSafetySignal, readonly RegExp[]>>> = Object.freeze({
  CHEST_PAIN_OR_PRESSURE: [/\b(?:chest pain|chest pressure|chest tightness)\b/u, /\b(?:dau nguc|tuc nguc)\b/u],
  FAINTING: [/\b(?:fainted|passed out)\b/u, /\bngat\b/u],
  SEVERE_BREATHLESSNESS: [/\b(?:severe trouble breathing|cannot speak a sentence)\b/u],
});
const mixedUser = /\b(?:i|me|my|toi|minh|em)\b/u;
const mixedCurrent = /\b(?:now|currently|during|while|am having|is happening|dang|bay gio|hien tai|khi dang|luc dang)\b/u;

const fold = (locale: M3Locale, text: string) => {
  const lowered = text.normalize("NFC").toLocaleLowerCase(locale);
  return locale === "vi" || locale === "es"
    ? lowered.normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d")
    : lowered;
};

const splitClauses = (text: string) => text
  .split(/[,.!?;。！？，、।]+|\s+(?:but|nhung|nhưng|pero|लेकिन|しかし|하지만|но|va|con|and|y|और|그리고|и)\s+/ui)
  .map(value => value.trim()).filter(Boolean);

const signalRelevant = (signal: TrainerSafetySignal) =>
  signal !== "ORDINARY_EXERTION" && signal !== "MILD_POST_EXERCISE_SORENESS";

const clarificationQuestions: Readonly<Record<M3Locale,
Readonly<Record<TrainerSafetyClarificationKind, string>>>> = Object.freeze({
  vi: Object.freeze({ SUBJECT: "Điều này đang xảy ra với bạn hay với người khác?",
    CURRENT_STATUS: "Điều này đang xảy ra bây giờ hoặc vừa xảy ra, hay là chuyện trước đây?" }),
  en: Object.freeze({ SUBJECT: "Is this happening to you or to someone else?",
    CURRENT_STATUS: "Is this happening now or did it happen in the past?" }),
  "zh-Hans": Object.freeze({ SUBJECT: "这是发生在你身上，还是其他人身上？",
    CURRENT_STATUS: "这是现在或刚刚发生的，还是过去的事？" }),
  es: Object.freeze({ SUBJECT: "¿Te ocurre a ti o a otra persona?",
    CURRENT_STATUS: "¿Está ocurriendo ahora o acaba de ocurrir, o fue en el pasado?" }),
  hi: Object.freeze({ SUBJECT: "क्या यह आपके साथ हो रहा है या किसी और के साथ?",
    CURRENT_STATUS: "क्या यह अभी हो रहा है या अभी-अभी हुआ, या यह पुरानी बात है?" }),
  ja: Object.freeze({ SUBJECT: "これはあなたに起きていることですか、それとも他の人のことですか？",
    CURRENT_STATUS: "これは今または直前に起きたことですか、それとも過去のことですか？" }),
  ko: Object.freeze({ SUBJECT: "이 일은 본인에게 일어난 건가요, 아니면 다른 사람의 일인가요?",
    CURRENT_STATUS: "이 일은 지금 또는 방금 일어난 건가요, 아니면 과거의 일인가요?" }),
  ru: Object.freeze({ SUBJECT: "Это происходит с вами или с другим человеком?",
    CURRENT_STATUS: "Это происходит сейчас или произошло недавно, либо это было в прошлом?" }),
});

const clarificationAnswerRules: Readonly<Record<M3Locale, Readonly<{
  user: RegExp; other: RegExp; current: RegExp; historical: RegExp;
}>>> = Object.freeze({
  vi: Object.freeze({ user: /\b(?:toi|minh|em|voi toi)\b/u,
    other: /\b(?:ban toi|nguoi khac|anh ay|co ay|khong phai toi)\b/u,
    current: /\b(?:bay gio|hien tai|vua xay ra|moi xay ra)\b/u,
    historical: /\b(?:nam ngoai|truoc day|chuyen truoc day|khong phai bay gio)\b/u }),
  en: Object.freeze({ user: /\b(?:me|myself|about me|happening to me)\b/u,
    other: /\b(?:my friend|someone else|another person|about him|about her|not me)\b/u,
    current: /\b(?:now|currently|just happened|happening now)\b/u,
    historical: /\b(?:last year|in the past|happened before|not now|historical)\b/u }),
  "zh-Hans": Object.freeze({ user: /(?:是我|我本人|发生在我身上)/u,
    other: /(?:我的朋友|其他人|别人|不是我)/u,
    current: /(?:现在|刚刚|刚才)/u, historical: /(?:去年|以前|过去|不是现在)/u }),
  es: Object.freeze({ user: /\b(?:a mi|sobre mi|yo mismo)\b/u,
    other: /\b(?:mi amigo|mi amiga|otra persona|no soy yo)\b/u,
    current: /\b(?:ahora|actualmente|acaba de ocurrir)\b/u,
    historical: /\b(?:el ano pasado|en el pasado|antes|no ahora)\b/u }),
  hi: Object.freeze({ user: /(?:मेरे साथ|मैं ही|मेरे बारे में)/u,
    other: /(?:मेरा दोस्त|मेरी दोस्त|किसी और|मेरे साथ नहीं)/u,
    current: /(?:अभी|अभी-अभी|इस समय)/u, historical: /(?:पिछले साल|पहले|पुरानी बात|अभी नहीं)/u }),
  ja: Object.freeze({ user: /(?:私です|私のこと|私に起き)/u,
    other: /(?:友人|友達|他の人|私ではない)/u,
    current: /(?:今|たった今|先ほど)/u, historical: /(?:去年|以前|過去|今ではない)/u }),
  ko: Object.freeze({ user: /(?:제 일|내 일|저에게|나에게)/u,
    other: /(?:제 친구|내 친구|다른 사람|제가 아니)/u,
    current: /(?:지금|방금|현재)/u, historical: /(?:작년|예전에|과거|지금이 아니)/u }),
  ru: Object.freeze({ user: /(?:^|\s)(?:со мной|обо мне|это я)(?=\s|[,.!?]|$)/u,
    other: /(?:^|\s)(?:мой друг|моя подруга|другой человек|не я)(?=\s|[,.!?]|$)/u,
    current: /(?:^|\s)(?:сейчас|только что|в данный момент)(?=\s|[,.!?]|$)/u,
    historical: /(?:^|\s)(?:в прошлом году|раньше|в прошлом|не сейчас)(?=\s|[,.!?]|$)/u }),
});

export function recognizeTrainerSafety(
  locale: M3Locale,
  currentText: string,
  revision = 0,
): readonly TrainerSafetyObservation[] {
  const localeRules = rules[locale];
  const text = fold(locale, currentText);
  const observations: TrainerSafetyObservation[] = [];
  let inheritedSubject: TrainerSafetySubject | undefined;
  let inheritedTime: TrainerSafetyTime | undefined;
  let inheritedAssertion: Extract<TrainerSafetyAssertion, "HYPOTHETICAL" | "UNCERTAIN"> | undefined;
  for (const clause of splitClauses(text)) {
    // The bounded mixed-language critical floor uses ASCII-folded Latin
    // aliases without changing the selected locale's own recognition rules.
    const mixedClause = fold("vi", clause);
    const hypothetical = localeRules.hypothetical.test(clause);
    const explicitAssertion = hypothetical ? "HYPOTHETICAL" as const
      : localeRules.uncertain.test(clause) ? "UNCERTAIN" as const : undefined;
    const explicitTime: TrainerSafetyTime = localeRules.historical.test(clause) ? "HISTORICAL"
      : localeRules.recent.test(clause) ? "RECENT_UNRESOLVED"
      : localeRules.current.test(clause) || mixedCurrent.test(mixedClause) ? "CURRENT" : "UNKNOWN";
    const explicitSubject: TrainerSafetySubject = localeRules.other.test(clause) ? "OTHER"
      : localeRules.user.test(clause) || mixedUser.test(mixedClause)
        || explicitTime === "CURRENT" || explicitTime === "RECENT_UNRESOLVED"
        ? "USER" : "UNKNOWN";
    const time = explicitTime !== "UNKNOWN" ? explicitTime : inheritedTime ?? "UNKNOWN";
    const subject = explicitSubject !== "UNKNOWN" ? explicitSubject : inheritedSubject ?? "UNKNOWN";
    let matchedSignal = false;
    for (const signal of Object.keys(localeRules.signals) as TrainerSafetySignal[]) {
      const patterns = localeRules.signals[signal];
      if (signal === "FAINTING" && localeRules.signals.NEAR_FAINTING.some(pattern => pattern.test(clause))) {
        continue;
      }
      for (const pattern of [...patterns, ...(mixedCritical[signal] ?? [])]) {
        const matchedClause = patterns.includes(pattern) ? clause : mixedClause;
        const match = pattern.exec(matchedClause);
        if (!match) continue;
        const prefix = matchedClause.slice(0, match.index);
        const suffix = matchedClause.slice(match.index + match[0].length);
        const assertion: TrainerSafetyAssertion = explicitAssertion ?? inheritedAssertion
          ?? (localeRules.negation.test(prefix) || localeRules.negation.test(suffix.slice(0, 10))
            ? "NEGATED" : "ASSERTED");
        // An explicit action-pain construction (for example, "sharp pain while
        // walking") is itself current first-person action evidence. Other
        // bare signals keep UNKNOWN subject/time and require clarification.
        const implicitCurrentSignal = signal === "ACTION_RELEVANT_PAIN"
          || signal === "SUDDEN_NEUROLOGIC_WARNING";
        const observedSubject: TrainerSafetySubject = subject === "UNKNOWN"
          && implicitCurrentSignal ? "USER" : subject;
        const observedTime: TrainerSafetyTime = time === "UNKNOWN" && assertion === "ASSERTED"
          && observedSubject === "USER" ? "CURRENT" : time;
        const currentness = assertion === "UNCERTAIN" || observedTime === "UNKNOWN" ? "UNCERTAIN" as const
          : assertion === "ASSERTED" && observedTime !== "HISTORICAL" ? "CURRENT" as const : "NOT_CURRENT" as const;
        observations.push(Object.freeze({
          subject: observedSubject, time: observedTime, assertion, signal,
          action_relevance: signalRelevant(signal) ? "RELEVANT" : "NOT_APPLICABLE",
          source: "USER_TEXT", revision, currentness,
        }));
        matchedSignal = true;
        break;
      }
    }
    if (matchedSignal) {
      inheritedSubject = undefined;
      inheritedTime = undefined;
      inheritedAssertion = undefined;
    } else {
      inheritedSubject = explicitSubject !== "UNKNOWN" ? explicitSubject : undefined;
      inheritedTime = explicitTime !== "UNKNOWN" ? explicitTime : undefined;
      inheritedAssertion = explicitAssertion;
    }
  }
  return Object.freeze(observations);
}

const urgent = new Set<TrainerSafetySignal>([
  "CHEST_PAIN_OR_PRESSURE", "FAINTING", "SEVERE_BREATHLESSNESS", "SUDDEN_NEUROLOGIC_WARNING",
]);
const pain = new Set<TrainerSafetySignal>(["ACTION_RELEVANT_PAIN", "SUSPECTED_ACUTE_INJURY"]);

export function decideTrainerSafety(
  observations: readonly TrainerSafetyObservation[],
  locale: M3Locale = "en",
): TrainerSafetyDecision {
  if (observations.length === 0) return Object.freeze({
    recognition: "NO_MATCH", knowledge: "UNKNOWN", level: "CLEAR",
    authority_effect: "NONE", clarification: null, observations: Object.freeze([]),
  });
  let level: TrainerSafetyLevel = "CLEAR";
  let unknown = false;
  let subjectUnknown = false;
  for (const item of observations) {
    if (item.subject === "OTHER" || item.assertion === "NEGATED"
      || item.assertion === "HYPOTHETICAL" || item.time === "HISTORICAL") continue;
    if (item.subject === "UNKNOWN" || item.assertion === "UNCERTAIN"
      || item.time === "UNKNOWN") {
      if (item.action_relevance === "RELEVANT") {
        unknown = true;
        if (item.subject === "UNKNOWN") subjectUnknown = true;
      }
      continue;
    }
    if (urgent.has(item.signal)) level = "URGENT";
    else if (level !== "URGENT" && pain.has(item.signal)) level = "PAIN";
    else if (level === "CLEAR" && item.action_relevance === "RELEVANT") level = "SENSITIVE";
  }
  if (level === "CLEAR" && unknown) level = "SENSITIVE";
  const clarificationKind: TrainerSafetyClarificationKind | null = level === "SENSITIVE" && unknown
    ? subjectUnknown ? "SUBJECT" : "CURRENT_STATUS" : null;
  const clarification = level === "SENSITIVE" && unknown
    ? Object.freeze({ kind: clarificationKind!, question: clarificationQuestions[locale][clarificationKind!] })
    : null;
  return Object.freeze({
    recognition: "MATCH", knowledge: unknown ? "UNKNOWN" : "KNOWN", level,
    authority_effect: level === "URGENT" ? "URGENT_HELP"
      : level === "PAIN" ? "STOP_RELEVANT_ACTION" : level === "SENSITIVE" ? "HOLD" : "NONE",
    clarification,
    observations: Object.freeze([...observations]),
  });
}

/**
 * Applies one bounded, local answer to the exact clarification axis that was
 * asked. It changes observation provenance only; it grants no task authority.
 */
function clarifyPriorTrainerSafety(
  locale: M3Locale,
  prior: TrainerSafetyDecision,
  answerText: string,
  revision: number,
) {
  const kind = prior.clarification?.kind;
  if (!kind || prior.level !== "SENSITIVE" || prior.knowledge !== "UNKNOWN") return undefined;
  const answerRules = clarificationAnswerRules[locale];
  const subjects = new Set<"USER" | "OTHER">();
  const times = new Set<"CURRENT" | "HISTORICAL">();
  const correctionClauses: string[] = [];
  for (const rawClause of splitClauses(answerText)) {
    const clause = fold(locale, rawClause);
    // A new Safety observation owns its own subject and time. It cannot be
    // used to answer the question about a different, earlier observation.
    if (recognizeTrainerSafety(locale, clause, revision).length) continue;
    const negated = rules[locale].negation.test(clause);
    const other = answerRules.other.test(clause);
    // Possessives inside an OTHER phrase ("bạn tôi", "我的朋友") do not
    // independently assert that the old event happened to the user.
    const withoutOther = other
      ? clause.replace(new RegExp(answerRules.other.source, "gu"), " ") : clause;
    const user = answerRules.user.test(withoutOther);
    const historical = answerRules.historical.test(clause);
    const current = answerRules.current.test(clause);
    if (other || user || historical || current) correctionClauses.push(rawClause);
    if (other) subjects.add("OTHER");
    if (user && !(other && negated)) subjects.add("USER");
    if (historical) times.add("HISTORICAL");
    if (current && !(historical && negated)) times.add("CURRENT");
  }
  // Contradictory answers cannot silently choose OTHER or HISTORICAL.
  if (subjects.size > 1 || times.size > 1) return undefined;
  const subject = subjects.values().next().value;
  const time = times.values().next().value;
  // OTHER or HISTORICAL is independently sufficient to make a current-user
  // observation inapplicable. Otherwise the answer must resolve the one axis
  // that was actually asked.
  if (subject !== "OTHER" && time !== "HISTORICAL"
    && (kind === "SUBJECT" ? subject === undefined : time === undefined)) return undefined;
  const target = prior.observations.findIndex(item => item.action_relevance === "RELEVANT"
    && item.subject !== "OTHER" && item.time !== "HISTORICAL"
    && item.assertion !== "NEGATED" && item.assertion !== "HYPOTHETICAL"
    && (kind === "SUBJECT" ? item.subject === "UNKNOWN"
      : item.time === "UNKNOWN" || item.assertion === "UNCERTAIN"));
  if (target < 0) return undefined;
  const observations = prior.observations.map((item, index) => {
    if (index !== target) return item;
    const nextSubject = subject ?? item.subject;
    const nextTime = time ?? item.time;
    const assertion = item.assertion === "UNCERTAIN" && time ? "ASSERTED" as const : item.assertion;
    const currentness = assertion === "UNCERTAIN" || nextTime === "UNKNOWN" ? "UNCERTAIN" as const
      : assertion === "ASSERTED" && nextTime !== "HISTORICAL" ? "CURRENT" as const : "NOT_CURRENT" as const;
    return Object.freeze({ ...item, subject: nextSubject, time: nextTime, assertion, currentness, revision });
  });
  return Object.freeze({ decision: decideTrainerSafety(Object.freeze(observations), locale),
    correctionText: correctionClauses.join(', ') });
}

export function reassessTrainerSafetyClarification(
  locale: M3Locale,
  prior: TrainerSafetyDecision,
  answerText: string,
  revision: number,
): TrainerSafetyDecision | undefined {
  return clarifyPriorTrainerSafety(locale, prior, answerText, revision)?.decision;
}

export function composeTrainerSafetyClarificationAnswer(
  locale: M3Locale,
  prior: TrainerSafetyDecision,
  answerText: string,
  revision: number,
  independentSafety: TrainerSafetyLevel = "CLEAR",
) {
  const correction = clarifyPriorTrainerSafety(locale, prior, answerText, revision);
  const correctedPrior = correction?.decision;
  const freshObservations = recognizeTrainerSafety(locale, answerText, revision);
  const composed = decideTrainerSafety(Object.freeze([
    ...(correctedPrior ?? prior).observations, ...freshObservations,
  ]), locale);
  const priority: readonly TrainerSafetyLevel[] = ["CLEAR", "SENSITIVE", "PAIN", "URGENT"];
  const level = priority.indexOf(independentSafety) > priority.indexOf(composed.level)
    ? independentSafety : composed.level;
  const effective = level === composed.level ? composed : Object.freeze({
    ...composed, recognition: "MATCH" as const, level,
    authority_effect: level === "URGENT" ? "URGENT_HELP" as const
      : level === "PAIN" ? "STOP_RELEVANT_ACTION" as const : "HOLD" as const,
    clarification: null,
  });
  return Object.freeze({
    correctedPrior: correctedPrior ?? null,
    correctionText: correction?.correctionText ?? null,
    freshObservations,
    effective,
    correctionResolved: correctedPrior?.level === "CLEAR",
  });
}

export function evaluateTrainerSafetyText(
  locale: M3Locale,
  currentText: string,
  revision = 0,
): TrainerSafetyDecision {
  return decideTrainerSafety(recognizeTrainerSafety(locale, currentText, revision), locale);
}
