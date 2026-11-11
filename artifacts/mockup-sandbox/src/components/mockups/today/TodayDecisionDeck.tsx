import React, { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Compass,
  HeartPulse,
  Minus,
  MoreHorizontal,
  Pause,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
} from "lucide-react";

type Choice = "accept" | "pause" | null;

export function TodayDecisionDeck() {
  const [choice, setChoice] = useState<Choice>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [loadReduced, setLoadReduced] = useState(false);
  const [mode, setMode] = useState<"guided" | "quiet">("guided");

  const accept = () => setChoice("accept");
  const pause = () => setChoice("pause");

  return (
    <main className="min-h-[100dvh] bg-[#f4f0e8] px-4 py-5 text-[#17263a] sm:px-8 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100dvh-40px)] max-w-[480px] flex-col">
        <header className="mb-7 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-[12px] bg-[#1d3557] text-[#fbf9f4]">
              <Sun size={17} strokeWidth={2.2} />
            </div>
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[.19em] text-[#6d7480]">100 / DEMO · LOCAL</div>
              <h1 className="mt-1 text-[21px] font-bold tracking-[-.04em]">Hôm nay</h1>
            </div>
          </div>
          <button
            aria-label="More options"
            className="grid h-9 w-9 place-items-center rounded-full border border-[#d8d0c3] bg-[#fbf9f4] text-[#6d7480] transition-transform hover:scale-105"
            onClick={() => setShowDetails(!showDetails)}
          >
            <MoreHorizontal size={18} />
          </button>
        </header>

        <section className="mb-5 rounded-[26px] border border-[#d8d0c3] bg-[#fbf9f4] p-5 shadow-[0_12px_35px_rgba(43,53,68,.06)] sm:p-6">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#dde8e4] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-[#205248]">
                <Sparkles size={12} /> Một lựa chọn
              </div>
              <p className="mt-2 text-[13px] text-[#6d7480]">Dựa trên điều bạn muốn giữ hôm nay</p>
            </div>
            <div className="rounded-full bg-[#e8e1d5] px-2.5 py-1 font-mono text-[10px] text-[#6d7480]">09:40</div>
          </div>
          <h2 className="max-w-[355px] text-[28px] font-bold leading-[1.12] tracking-[-.045em]">
            Giữ nhịp làm việc sâu, nhưng đừng cố thắng cả ngày.
          </h2>
          <div className="mt-6 border-t border-[#e8e1d5] pt-4">
            <div className="flex items-center gap-2 text-[12px] text-[#6d7480]">
              <Compass size={14} className="text-[#c98755]" />
              <span>Context đủ dùng · không cần mở thêm dữ liệu</span>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <button
              onClick={accept}
              className={`flex min-h-[49px] items-center justify-center gap-2 rounded-[14px] px-4 text-[13px] font-bold transition-all ${choice === "accept" ? "bg-[#205248] text-[#fbf9f4]" : "bg-[#1d3557] text-[#fbf9f4] hover:bg-[#294b76]"}`}
            >
              {choice === "accept" ? <Check size={16} /> : <ArrowRight size={16} />}
              {choice === "accept" ? "Đã chọn" : "Chọn làm việc này"}
            </button>
            <button
              onClick={pause}
              className={`flex min-h-[49px] items-center justify-center gap-2 rounded-[14px] border px-4 text-[13px] font-bold transition-all ${choice === "pause" ? "border-[#c98755] bg-[#f0e1d3] text-[#8b5734]" : "border-[#d8d0c3] bg-[#e8e1d5] text-[#263b54] hover:bg-[#f0e1d3]"}`}
            >
              {choice === "pause" ? <Check size={16} /> : <Pause size={15} />}
              {choice === "pause" ? "Đã để sau" : "Để sau"}
            </button>
          </div>
        </section>

        {choice && (
          <div className="mb-5 flex items-center gap-3 rounded-[16px] border border-[#c9dcd6] bg-[#e8f0ed] px-4 py-3 text-[12px] text-[#205248]">
            <ShieldCheck size={18} />
            <span>{choice === "accept" ? "Bạn vẫn là người quyết định. Khi xong, hãy quay lại ghi outcome." : "Không cần quyết định ngay. Goal của bạn vẫn được giữ lại."}</span>
            <button onClick={() => setChoice(null)} className="ml-auto rounded-full p-1 hover:bg-[#d4e5df]"><X size={14} /></button>
          </div>
        )}

        <div className="mb-2 flex items-center justify-between px-1">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6d7480]">Bản đồ quyết định</span>
          <button onClick={() => setShowDetails(!showDetails)} className="flex items-center gap-1 text-[12px] font-semibold text-[#205248]">
            {showDetails ? "Thu gọn" : "Xem cách tính"} <ChevronDown size={14} className={showDetails ? "rotate-180" : ""} />
          </button>
        </div>
        <section className="mb-4 overflow-hidden rounded-[20px] border border-[#d8d0c3] bg-[#fbf9f4]">
          <div className="relative p-4">
            <div className="absolute bottom-4 left-[27px] top-4 w-px bg-[#d8d0c3]" />
            {[
              ["GOAL", "Giữ nhịp làm việc sâu", true],
              ["CONTEXT", "Lịch demo được cho phép", true],
              ["UNDERSTANDING", "Bạn cần một bước đủ nhỏ để bắt đầu", true],
              ["OUTCOME", choice ? "Đang chờ bạn đóng vòng" : "Chưa đóng vòng", Boolean(choice)],
            ].map(([label, value, done], index) => (
              <div key={label as string} className="relative flex gap-3 py-2.5">
                <div className={`z-10 mt-1 grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full border-2 ${done ? "border-[#1d3557] bg-[#1d3557]" : "border-[#d8d0c3] bg-[#fbf9f4]"}`}>
                  {done && <Check size={10} color="#fbf9f4" />}
                </div>
                <div>
                  <div className="font-mono text-[9px] font-bold tracking-[.15em] text-[#8a919a]">{label as string}</div>
                  <div className="mt-0.5 text-[13px] leading-[1.35]">{value as string}</div>
                </div>
              </div>
            ))}
          </div>
          {showDetails && (
            <div className="border-t border-[#e8e1d5] bg-[#f4f0e8] px-4 py-3 text-[12px] leading-[1.5] text-[#6d7480]">
              Gợi ý này chỉ dùng goal và context DEMO/LOCAL. Không có dữ liệu ẩn, không có quyết định thay bạn.
            </div>
          )}
        </section>

        <section className="mt-auto rounded-[20px] border border-[#d8d0c3] bg-[#e8e1d5] p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#f0e1d3] text-[#8b5734]"><HeartPulse size={16} /></div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-bold">{loadReduced ? "Chế độ Recover đang bật" : "Cảm giác quá tải?"}</h3>
                <Clock3 size={15} className="text-[#8a919a]" />
              </div>
              <p className="mt-1 text-[12px] leading-[1.45] text-[#6d7480]">{loadReduced ? "Không có mục tiêu nào cần chứng minh ngay." : "Giảm tải không phải thất bại. Nó là một quyết định hợp lệ."}</p>
            </div>
          </div>
          <button onClick={() => setLoadReduced(!loadReduced)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[12px] border border-[#cfc5b7] bg-[#f4f0e8] py-2.5 text-[12px] font-bold text-[#263b54] hover:bg-[#fbf9f4]">
            {loadReduced ? <><Minus size={14} /> Trở lại nhịp bình thường</> : <><Pause size={14} /> Reduce Load</>}
          </button>
        </section>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-[#8a919a]">
          <span>GỢI Ý CÓ THỂ SAI</span><span>·</span>
          <button onClick={() => setMode(mode === "guided" ? "quiet" : "guided")} className="font-bold text-[#205248]">{mode === "guided" ? "Recommendation" : "Silence"} đang bật</button>
        </div>
      </div>
    </main>
  );
}

export default TodayDecisionDeck;