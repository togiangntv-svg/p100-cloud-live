import type { ReleaseLocale } from './i18n-opening';
import type { W01AnswerId, W01QuestionId } from './components/w01-product-controller';

type Copy = Readonly<{
  questions: Record<W01QuestionId, string>; answers: Record<W01AnswerId, string>;
  global_skip: string; actions: Record<'accept' | 'start' | 'cancel' | 'stop' | 'end', string>;
  accepted: string; started: string; ended: string; outcomes: Record<string, string>;
}>;
const make = (questions: string[], words: string[], ui: string[]): Copy => ({
  questions: Object.fromEntries(['walking_choice','concerns','professional_limits','adult','mobility','setting','competing_activity','footwear','available_minutes','requested_minutes'].map((k,i)=>[k,questions[i]])) as Record<W01QuestionId,string>,
  answers: Object.fromEntries(['yes','decline','not_sure','skip','none','pain','dizzy','breathless','unresolved','urgent','restricted','adult','not_adult','independent','needs_support','supported','unsupported','none_competing','hazardous','suitable','unsuitable','1','2','3','4','5'].map((k,i)=>[k,words[i] ?? k])) as Record<W01AnswerId,string>,
  global_skip: ui[0], actions: { accept: ui[1], start: ui[2], cancel: ui[3], stop: ui[4], end: ui[17] }, accepted: ui[5], started: ui[6], ended: ui[18],
  outcomes: { URGENT_HELP: ui[7], SAFETY_HOLD: ui[8], NO_ACTION: ui[9], UNSUPPORTED: ui[10], SOURCE_BLOCKED: ui[11], DISMISSED: ui[12], UNAVAILABLE: ui[13], DENIED: ui[13], CANCELLED: ui[14], STOPPED: ui[15], INVALIDATED: ui[16] },
});
const nums = ['1','2','3','4','5'];
export const W01_COPY: Record<ReleaseLocale, Copy> = {
  en: make(['Would you like this short, light walk now?','Do you have a current concern?','Do you have a current restriction from a professional?','Are you an adult?','Can you walk comfortably without support?','Is there a flat, clear, lit, dry place where you can stop?','Are you doing another activity that makes walking unsuitable?','Are you wearing familiar, secure footwear?','How many minutes are available now?','How many minutes would you like to walk (up to the available time)?'], ['Yes','No, decline','Not sure','Skip this question','None to report','Pain','Dizziness','Unusual breathlessness','An unresolved concern','Urgent concern','A restriction applies','I am an adult','I am not an adult','Yes, independently','I need support','Yes','No','No competing activity','A competing activity','Suitable footwear','Unsuitable footwear',...nums], ['Skip this flow','Choose this walk','I am starting now','Cancel','Stop','Chosen, not started.','Started because you reported starting. You can stop at any time.','Seek urgent help where you are.','Do not continue to a walk proposal.','No walk will be proposed.','This walk is not supported for the reported context.','The walk source is unavailable.','Flow dismissed.','This action is unavailable.','Cancelled.','Stopped.','This walk will not reopen automatically.',"End this walk","You reported ending this walk."]),
  vi: make(['Bạn có muốn đi bộ nhẹ, ngắn ngay lúc này?','Hiện bạn có lo ngại nào không?','Hiện bạn có giới hạn nào từ chuyên gia không?','Bạn có phải người lớn không?','Bạn có thể đi bộ thoải mái mà không cần hỗ trợ không?','Có nơi bằng phẳng, quang, đủ sáng, khô ráo và có thể dừng không?','Bạn có đang làm hoạt động khác khiến việc đi bộ không phù hợp không?','Bạn có đang mang giày dép quen thuộc, chắc chắn không?','Hiện có bao nhiêu phút?','Bạn muốn đi bộ bao nhiêu phút (không quá thời gian hiện có)?'], ['Có','Không, từ chối','Không chắc','Bỏ qua câu này','Không có','Đau','Chóng mặt','Khó thở bất thường','Lo ngại chưa giải quyết','Lo ngại khẩn cấp','Có giới hạn','Tôi là người lớn','Tôi không phải người lớn','Có, không cần hỗ trợ','Tôi cần hỗ trợ','Có','Không','Không có hoạt động khác','Có hoạt động khác','Phù hợp','Không phù hợp',...nums], ['Bỏ qua toàn bộ','Chọn lần đi bộ','Tôi đang bắt đầu','Hủy','Dừng','Đã chọn, chưa bắt đầu.','Đã bắt đầu theo lời bạn báo. Bạn có thể dừng bất cứ lúc nào.','Hãy tìm trợ giúp khẩn cấp tại nơi bạn đang ở.','Không tiếp tục tới đề xuất đi bộ.','Sẽ không đề xuất đi bộ.','Không hỗ trợ lần đi bộ trong bối cảnh đã báo.','Nguồn đi bộ không khả dụng.','Đã bỏ qua.','Hành động không khả dụng.','Đã hủy.','Đã dừng.','Lần đi bộ này sẽ không tự mở lại.',"Kết thúc lần đi bộ","Bạn đã báo kết thúc lần đi bộ này."]),
  'zh-Hans': make(['现在想进行这次短时轻松步行吗？','目前有任何不适吗？','目前有专业人士给出的限制吗？','你是成年人吗？','你能无需协助舒适行走吗？','是否有平坦、畅通、明亮、干燥且可停止的地方？','是否正在进行使步行不合适的其他活动？','是否穿着熟悉稳固的鞋？','现在有几分钟？','想走几分钟（不超过可用时间）？'], ['是','否，拒绝','不确定','跳过此问题','没有','疼痛','头晕','异常气促','尚未解决的不适','紧急不适','有限制','我是成年人','我不是成年人','可以独立行走','需要协助','是','否','没有其他活动','有其他活动','鞋合适','鞋不合适',...nums], ['跳过整个流程','选择步行','我现在开始','取消','停止','已选择，尚未开始。','已按你的报告开始，可随时停止。','请在你所在的位置寻求紧急帮助。','不要继续步行建议。','不会提出步行。','所报告情况不支持此次步行。','步行来源不可用。','已跳过。','此操作不可用。','已取消。','已停止。','此次步行不会自动重新打开。',"结束此次步行","你已报告结束此次步行。"]),
  es: make(['¿Quieres esta caminata corta y suave ahora?','¿Tienes alguna preocupación actual?','¿Tienes una restricción profesional actual?','¿Eres una persona adulta?','¿Puedes caminar cómodamente sin apoyo?','¿Hay un lugar plano, despejado, iluminado, seco y donde puedas parar?','¿Realizas otra actividad que haga inadecuado caminar?','¿Llevas calzado conocido y seguro?','¿Cuántos minutos tienes ahora?','¿Cuántos minutos quieres caminar (sin superar el tiempo disponible)?'], ['Sí','No, declino','No lo sé','Omitir pregunta','Ninguna','Dolor','Mareo','Falta de aire inusual','Preocupación sin resolver','Preocupación urgente','Hay restricción','Soy adulto/a','No soy adulto/a','Sí, sin apoyo','Necesito apoyo','Sí','No','Ninguna otra actividad','Otra actividad','Calzado adecuado','Calzado inadecuado',...nums], ['Omitir todo','Elegir caminata','Empiezo ahora','Cancelar','Detener','Elegida, no iniciada.','Iniciada según tu indicación; puedes detenerte.','Busca ayuda urgente donde estés.','No continúes a una propuesta.','No se propondrá una caminata.','El contexto indicado no es compatible.','La fuente no está disponible.','Flujo omitido.','Acción no disponible.','Cancelada.','Detenida.','No se reabrirá automáticamente.',"Finalizar esta caminata","Has indicado que terminaste esta caminata."]),
  hi: make(['क्या आप अभी थोड़ी देर हल्का चलना चाहते हैं?','क्या अभी कोई चिंता है?','क्या किसी पेशेवर ने अभी कोई रोक बताई है?','क्या आप वयस्क हैं?','क्या आप बिना सहारे आराम से चल सकते हैं?','क्या जगह समतल, साफ, रोशन, सूखी और रुकने योग्य है?','क्या कोई दूसरी गतिविधि चलने को अनुपयुक्त बनाती है?','क्या परिचित और सुरक्षित जूते पहने हैं?','अभी कितने मिनट उपलब्ध हैं?','आप कितने मिनट चलना चाहते हैं (उपलब्ध समय तक)?'], ['हाँ','नहीं, मना करें','पक्का नहीं','यह प्रश्न छोड़ें','कोई नहीं','दर्द','चक्कर','असामान्य सांस फूलना','अनसुलझी चिंता','तत्काल चिंता','रोक लागू है','मैं वयस्क हूँ','मैं वयस्क नहीं हूँ','हाँ, बिना सहारे','मुझे सहारा चाहिए','हाँ','नहीं','दूसरी गतिविधि नहीं','दूसरी गतिविधि है','उपयुक्त जूते','अनुपयुक्त जूते',...nums], ['पूरा प्रवाह छोड़ें','चलना चुनें','मैं अब शुरू कर रहा/रही हूँ','रद्द करें','रोकें','चुना, शुरू नहीं हुआ।','आपकी सूचना पर शुरू दर्ज हुआ; कभी भी रोकें।','जहाँ हैं वहाँ तत्काल सहायता लें।','चलने के प्रस्ताव पर आगे न बढ़ें।','चलना प्रस्तावित नहीं होगा।','बताया संदर्भ समर्थित नहीं है।','स्रोत उपलब्ध नहीं है।','छोड़ दिया।','कार्रवाई उपलब्ध नहीं।','रद्द।','रुका।','यह अपने आप नहीं खुलेगा।',"यह चलना समाप्त करें","आपने यह चलना समाप्त करने की सूचना दी है।"]),
  ja: make(['今、短時間の軽い歩行を希望しますか？','現在、気になる症状はありますか？','専門家から現在の制限を受けていますか？','成人ですか？','支えなしで無理なく歩けますか？','平らで片付き、明るく乾いていて止まれる場所ですか？','歩行に適さない別の活動中ですか？','履き慣れた安定した履物ですか？','今、何分使えますか？','利用可能時間内で何分歩きますか？'], ['はい','いいえ、辞退','わからない','この質問をスキップ','なし','痛み','めまい','異常な息切れ','未解決の懸念','緊急の懸念','制限あり','成人です','成人ではありません','はい、自立して','支えが必要','はい','いいえ','別の活動なし','別の活動あり','適した履物','適さない履物',...nums], ['すべてスキップ','この歩行を選ぶ','今から始めます','キャンセル','停止','選択済み、未開始。','開始の申告を記録しました。いつでも停止できます。','現在地で緊急の助けを求めてください。','歩行案へ進まないでください。','歩行は提案されません。','報告された状況では対応していません。','歩行情報を利用できません。','スキップしました。','操作できません。','キャンセル済み。','停止済み。','自動では再開しません。',"この歩行を終了する","この歩行を終了したという申告を記録しました。"]),
  ko: make(['지금 짧고 가볍게 걷고 싶나요?','현재 우려되는 증상이 있나요?','전문가가 현재 제한한 사항이 있나요?','성인인가요?','도움 없이 편안하게 걸을 수 있나요?','평평하고 정돈되고 밝고 건조하며 멈출 수 있는 장소인가요?','걷기에 부적합한 다른 활동 중인가요?','익숙하고 안정적인 신발을 신고 있나요?','지금 몇 분이 가능한가요?','가능한 시간 안에서 몇 분 걷고 싶나요?'], ['예','아니요, 거절','잘 모르겠음','이 질문 건너뛰기','없음','통증','어지러움','평소와 다른 숨참','해결되지 않은 우려','긴급한 우려','제한 있음','성인임','성인이 아님','예, 독립적으로','도움 필요','예','아니요','다른 활동 없음','다른 활동 있음','적합한 신발','부적합한 신발',...nums], ['전체 흐름 건너뛰기','걷기 선택','지금 시작합니다','취소','중지','선택됨, 시작 전.','시작했다고 보고되어 기록했습니다. 언제든 중지하세요.','현재 위치에서 긴급 도움을 구하세요.','걷기 제안으로 진행하지 마세요.','걷기를 제안하지 않습니다.','보고된 상황은 지원되지 않습니다.','걷기 소스를 사용할 수 없습니다.','건너뜀.','작업을 사용할 수 없습니다.','취소됨.','중지됨.','자동으로 다시 열리지 않습니다.',"이번 걷기 종료","이번 걷기를 종료했다고 보고했습니다."]),
  ru: make(['Хотите сейчас недолго и легко пройтись?','Есть ли сейчас беспокойство о самочувствии?','Есть ли текущее ограничение от специалиста?','Вы взрослый человек?','Можете комфортно ходить без поддержки?','Есть ровное, свободное, освещённое, сухое место, где можно остановиться?','Есть другое занятие, из-за которого ходьба не подходит?','На вас привычная надёжная обувь?','Сколько минут доступно сейчас?','Сколько минут хотите идти (не больше доступного времени)?'], ['Да','Нет, отказаться','Не уверен(а)','Пропустить вопрос','Нет','Боль','Головокружение','Необычная одышка','Нерешённое беспокойство','Срочное состояние','Есть ограничение','Я взрослый человек','Я не взрослый','Да, самостоятельно','Нужна поддержка','Да','Нет','Других занятий нет','Есть другое занятие','Подходящая обувь','Неподходящая обувь',...nums], ['Пропустить всё','Выбрать прогулку','Начинаю сейчас','Отменить','Остановиться','Выбрано, не начато.','Начало записано по вашему сообщению; можно остановиться.','Обратитесь за срочной помощью там, где вы находитесь.','Не переходите к предложению прогулки.','Прогулка не будет предложена.','Указанный контекст не поддерживается.','Источник прогулки недоступен.','Пропущено.','Действие недоступно.','Отменено.','Остановлено.','Автоматически не откроется.',"Завершить эту прогулку","Вы сообщили, что закончили эту прогулку."]),
};

/** Presentation copy only. Domain facts, provenance and safety classification remain unchanged. */
export const W01_CONTENT_COPY: Readonly<Record<ReleaseLocale, Readonly<{ title: string; instructions: string; warning: string; why: string }>>> = {
  "vi": {
    "title": "Đi bộ nhẹ — dự kiến {n} phút.",
    "instructions": "Chọn lối đi trong nhà bằng phẳng, thông thoáng; đi ở nhịp chậm và dễ chịu, không cố đi nhanh. Những bước đầu cứ thong thả, cuối đoạn chậm lại. Có thể dừng bất cứ lúc nào, không phải cố đủ phút.",
    "warning": "Dừng nếu đau, choáng, hụt hơi khác thường hoặc cảm thấy không ổn. Nếu tức/nặng ngực, khó thở nghiêm trọng hoặc ngất, tìm trợ giúp khẩn cấp tại nơi bạn đang ở.",
    "why": "Đây là một bước khởi đầu ngắn trong khoảng thời gian bạn chọn; chưa phải một chương trình vận động đầy đủ."
  },
  "en": {
    "title": "Gentle walk — planned {n} minutes.",
    "instructions": "Choose a flat, clear indoor path; walk at a slow, comfortable pace without trying to go fast. Take the first steps gently and slow down towards the end. You can stop at any time; you do not have to complete all the minutes.",
    "warning": "Stop if you have pain, dizziness, unusual breathlessness, or feel unwell. If you have chest tightness or heaviness, severe difficulty breathing, or faint, seek emergency help where you are.",
    "why": "This is a short first step within the time you chose; it is not yet a complete physical activity programme."
  },
  "zh-Hans": {
    "title": "轻松步行 — 计划 {n} 分钟。",
    "instructions": "选择平坦、通畅的室内路线；以缓慢、舒适的速度行走，不要勉强加速。开始时慢慢走，接近结束时再放慢。随时可以停止，不必坚持走满所选分钟数。",
    "warning": "如果疼痛、头晕、出现不同寻常的气短或感觉不适，请停止。如果胸部发紧或有沉重感、严重呼吸困难或昏厥，请在所在地寻求紧急帮助。",
    "why": "这是在你所选时间内迈出的一个短小起步，尚不是完整的运动计划。"
  },
  "es": {
    "title": "Caminata suave — {n} minutos previstos.",
    "instructions": "Elige un recorrido interior llano y despejado; camina a un ritmo lento y cómodo, sin intentar ir deprisa. Empieza con pasos tranquilos y reduce el ritmo al final. Puedes detenerte en cualquier momento; no tienes que completar todos los minutos.",
    "warning": "Detente si sientes dolor, mareo, falta de aire inusual o malestar. Si sientes opresión o pesadez en el pecho, tienes dificultad grave para respirar o te desmayas, busca ayuda de emergencia donde estés.",
    "why": "Este es un primer paso breve dentro del tiempo que has elegido; todavía no es un programa completo de actividad física."
  },
  "hi": {
    "title": "हल्का चलना — नियोजित समय {n} मिनट।",
    "instructions": "घर के भीतर समतल और साफ रास्ता चुनें; धीमी, आरामदायक गति से चलें, तेज चलने का ज़ोर न डालें। शुरुआत में आराम से कदम रखें और अंत में गति कम करें। आप कभी भी रुक सकते हैं; पूरे मिनट पूरे करना ज़रूरी नहीं है।",
    "warning": "दर्द, चक्कर, असामान्य रूप से सांस फूलने या अस्वस्थ महसूस होने पर रुकें। सीने में जकड़न या भारीपन, सांस लेने में गंभीर कठिनाई या बेहोशी होने पर जहाँ आप हैं वहाँ आपातकालीन सहायता लें।",
    "why": "यह आपके चुने हुए समय में एक छोटी शुरुआत है; यह अभी शारीरिक गतिविधि का पूरा कार्यक्रम नहीं है।"
  },
  "ja": {
    "title": "軽い歩行 — 予定 {n} 分。",
    "instructions": "平らで障害物のない屋内の道を選び、速く歩こうとせず、ゆっくり無理のないペースで歩いてください。最初は穏やかに歩き、終わりに近づいたらペースを落としてください。いつでも停止でき、選んだ時間を歩き切る必要はありません。",
    "warning": "痛み、めまい、普段と違う息切れ、体調不良があれば停止してください。胸の締め付けや重苦しさ、重い呼吸困難、失神がある場合は、現在地で緊急の助けを求めてください。",
    "why": "これは選んだ時間内での短い第一歩であり、まだ完全な運動プログラムではありません。"
  },
  "ko": {
    "title": "가벼운 걷기 — 예정 시간 {n}분.",
    "instructions": "평평하고 장애물이 없는 실내 길을 고르세요. 빨리 걸으려고 애쓰지 말고 천천히 편안한 속도로 걸으세요. 처음에는 여유롭게 걷고 마지막에는 속도를 줄이세요. 언제든 멈출 수 있으며, 정한 시간을 모두 채울 필요는 없습니다.",
    "warning": "통증, 어지러움, 평소와 다른 숨참이 있거나 몸이 좋지 않으면 멈추세요. 가슴이 조이거나 무겁고, 숨쉬기가 심하게 어렵거나 실신하면 현재 위치에서 응급 도움을 구하세요.",
    "why": "선택한 시간 안에서 시작하는 짧은 첫걸음이며, 아직 완전한 신체 활동 프로그램은 아닙니다."
  },
  "ru": {
    "title": "Лёгкая прогулка — запланировано {n} мин.",
    "instructions": "Выберите ровный свободный путь в помещении; идите медленно и в удобном темпе, не стараясь ускоряться. Первые шаги делайте спокойно, а в конце замедлитесь. Можно остановиться в любой момент; не обязательно идти все выбранные минуты.",
    "warning": "Остановитесь при боли, головокружении, необычной одышке или плохом самочувствии. При сдавлении или тяжести в груди, серьёзном затруднении дыхания или обмороке обратитесь за экстренной помощью там, где находитесь.",
    "why": "Это короткий первый шаг в пределах выбранного вами времени, а не полноценная программа физической активности."
  }
};

/** Accept only the exact current W01 resource shape and its structured duration. */
export function localizeW01Content(locale: ReleaseLocale, content: Readonly<{ title: string; instructions: string; warning: string; why: string }> | undefined, minutes: number | undefined) {
  if (!content || !Number.isInteger(minutes) || minutes! < 1 || minutes! > 5) return undefined;
  const canonical = W01_CONTENT_COPY.vi;
  if (content.title !== canonical.title.replace("{n}", String(minutes))
    || content.instructions !== canonical.instructions || content.warning !== canonical.warning
    || content.why !== canonical.why) return undefined;
  const copy = W01_CONTENT_COPY[locale];
  if (!copy) return undefined;
  return Object.freeze({ ...copy, title: copy.title.replace("{n}", String(minutes)) });
}
