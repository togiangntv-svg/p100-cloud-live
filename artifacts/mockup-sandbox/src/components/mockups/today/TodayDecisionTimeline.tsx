import React, { useState } from "react";
import {
  ArrowRight,
  BatteryCharging,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Compass,
  Flag,
  HeartPulse,
  Info,
  Leaf,
  MoreHorizontal,
  Pause,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
} from "lucide-react";

type CheckpointStatus = "done" | "current" | "upcoming";
type Choice = "accept" | "pause" | null;

type Checkpoint = {
  time: string;
  period: string;
  label: string;
  title: string;
  note: string;
  status: CheckpointStatus;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  action?: string;
};

const checkpoints: Checkpoint[] = [
  {
    time: "08:30",
    period: "BẮT ĐẦU",
    label: "Check-in",
    title: "Đặt một ý định đủ nhỏ",
    note: "Điều cần giữ hôm nay là nhịp làm việc sâu — không phải số giờ làm.",
    status: "done",
    icon: Sun,
  },
  {
    time: "09:40",
    period: "BÂY GIỜ",
    label: "Decision point",
    title: "Giữ nhịp làm việc sâu",
    note: "Lịch demo được cho phép. Chọn một bước có thể làm trong 45 phút, rồi dừng để kiểm tra lại.",
    status: "current",
    icon: Compass,
    action: "Chọn nhịp này",
  },
  {
    time: "12:15",
    period: "GIỮA NGÀY",
    label: "Reset",
    title: "Rời màn hình trước khi quá tải",
    note: "Một bữa trưa không cần tối ưu. Kiểm tra lại cơ thể trước khi mở thêm việc.",
    status: "upcoming",
    icon: Leaf,
    action: "Đặt lời nhắc",
  },
  {
    time: "15:30",
    period: "BUỔI CHIỀU",
    label: "Checkpoint",
    title: "Đóng một vòng đang mở",
    note: "Chọn việc đã có đủ context. Không mở thêm một dự án mới để lấp khoảng trống.",
    status: "upcoming",
    icon: Flag,
    action: "Để sau",
  },
  {
    time: "18:00",
    period: "KẾT NGÀY",
    label: "Outcome",
    title: "Rời công việc với phần còn lại rõ ràng",
    note: "Ghi lại bước tiếp theo. Ngày mai không cần bắt đầu bằng việc nhớ lại hôm nay.",
    status: "upcoming",
    icon: ShieldCheck,
    action: "Xem cách đóng vòng",
  },
];

export function TodayDecisionTimeline() {
  const [expanded, setExpanded] = useState<number | null>(1);
  const [choice, setChoice] = useState<Choice>(null);
  const [reduced, setReduced] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [quiet, setQuiet] = useState(false);

  const toggleCheckpoint = (index: number) => {
    setExpanded((current) => (current === index ? null : index));
  };

  const choose = (nextChoice: Choice) => {
    setChoice(nextChoice);
    setExpanded(1);
  };

  return (
    <main className="min-h-[100dvh] bg-[#f4f0e8] px-4 py-5 text-[#17263a] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-[920px]">
        <header className="mb-7 flex items-start justify-between sm:mb-9">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[13px] bg-[#1d3557] text-[#fbf9f4] shadow-[0_8px_20px_rgba(29,53,87,.14)]">
              <Sun size={18} strokeWidth={2.2} />
            </div>
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[.19em] text-[#6d7480]">
                100 / DEMO · LOCAL
              </div>
              <h1 className="mt-1 text-[21px] font-bold tracking-[-.04em]">Hôm nay</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden rounded-full border border-[#d8d0c3] bg-[#fbf9f4] px-3 py-2 font-mono text-[10px] text-[#6d7480] sm:block">
              THỨ BA · 24 THÁNG 9
            </div>
            <button
              aria-label="Mở thêm tuỳ chọn"
              className="grid h-9 w-9 place-items-center rounded-full border border-[#d8d0c3] bg-[#fbf9f4] text-[#6d7480] transition-transform hover:scale-105"
              onClick={() => setShowContext((value) => !value)}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
        </header>

        <section className="mb-7 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <div className="rounded-[26px] border border-[#d8d0c3] bg-[#fbf9f4] p-5 shadow-[0_14px_36px_rgba(43,53,68,.06)] sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#dde8e4] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-[#205248]">
                  <Sparkles size={12} /> Nhịp của ngày
                </div>
                <p className="text-[13px] text-[#6d7480]">Một timeline có điểm dừng, không phải checklist.</p>
              </div>
              <div className="shrink-0 rounded-full bg-[#e8e1d5] px-2.5 py-1 font-mono text-[10px] text-[#6d7480]">
                09:40
              </div>
            </div>
            <h2 className="mt-6 max-w-[560px] text-[30px] font-bold leading-[1.08] tracking-[-.05em] sm:text-[38px]">
              Làm sâu một đoạn.
              <br />
              <span className="text-[#205248]">Đừng cố thắng cả ngày.</span>
            </h2>
            <div className="mt-7 flex flex-wrap items-center gap-2 border-t border-[#e8e1d5] pt-4 text-[12px] text-[#6d7480]">
              <Clock3 size={14} className="text-[#c98755]" />
              <span>45 phút tập trung</span>
              <span className="text-[#b0a99e]">·</span>
              <span>1 checkpoint sau đó</span>
              <button
                onClick={() => setShowContext((value) => !value)}
                className="ml-auto flex items-center gap-1 font-semibold text-[#205248]"
              >
                Context <Info size={13} />
              </button>
            </div>
            {showContext && (
              <div className="mt-4 rounded-[14px] border border-[#d4e1dc] bg-[#edf4f0] px-3.5 py-3 text-[12px] leading-[1.5] text-[#42625c]">
                Dùng goal và context DEMO/LOCAL. Không có dữ liệu ẩn, không có quyết định thay bạn.
              </div>
            )}
            <div className="mt-5 grid gap-2.5 sm:grid-cols-[1.25fr_1fr]">
              <button
                onClick={() => choose("accept")}
                className={`flex min-h-[49px] items-center justify-center gap-2 rounded-[14px] px-4 text-[13px] font-bold transition-colors ${
                  choice === "accept"
                    ? "bg-[#205248] text-[#fbf9f4]"
                    : "bg-[#1d3557] text-[#fbf9f4] hover:bg-[#294b76]"
                }`}
              >
                {choice === "accept" ? <Check size={16} /> : <ArrowRight size={16} />}
                {choice === "accept" ? "Đã chọn nhịp này" : "Chọn làm việc này"}
              </button>
              <button
                onClick={() => choose("pause")}
                className={`flex min-h-[49px] items-center justify-center gap-2 rounded-[14px] border px-4 text-[13px] font-bold transition-colors ${
                  choice === "pause"
                    ? "border-[#c98755] bg-[#f0e1d3] text-[#8b5734]"
                    : "border-[#d8d0c3] bg-[#e8e1d5] text-[#263b54] hover:bg-[#f0e1d3]"
                }`}
              >
                {choice === "pause" ? <Check size={16} /> : <Pause size={15} />}
                {choice === "pause" ? "Đã giữ lại" : "Cần giảm tải"}
              </button>
            </div>
            {choice && (
              <div className="mt-3 flex items-center gap-2 rounded-[12px] bg-[#edf4f0] px-3 py-2.5 text-[12px] text-[#42625c]">
                <Check size={14} className="shrink-0 text-[#205248]" />
                <span>{choice === "accept" ? "Mốc 09:40 đã được thêm vào nhịp hôm nay." : "Không cần chứng minh thêm trong mốc này."}</span>
                <button
                  aria-label="Bỏ lựa chọn"
                  onClick={() => setChoice(null)}
                  className="ml-auto rounded-full p-1 hover:bg-[#d4e5df]"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          <aside className="rounded-[22px] border border-[#d8d0c3] bg-[#e8e1d5] p-4 sm:p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#f0e1d3] text-[#8b5734]">
                  <HeartPulse size={16} />
                </div>
                <div>
                  <div className="font-mono text-[9px] font-bold uppercase tracking-[.15em] text-[#8a919a]">Năng lượng</div>
                  <h3 className="mt-0.5 text-[14px] font-bold">{reduced ? "Recover đang bật" : "Đủ dùng hôm nay"}</h3>
                </div>
              </div>
              <BatteryCharging size={16} className="text-[#8a919a]" />
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#d5cbbd]">
              <div className={`h-full rounded-full bg-[#c98755] transition-all ${reduced ? "w-[32%]" : "w-[68%]"}`} />
            </div>
            <p className="mt-3 text-[12px] leading-[1.45] text-[#6d7480]">
              {reduced ? "Chỉ giữ các mốc cần thiết. Phần còn lại có thể chờ." : "Giữ lại khoảng trống giữa các mốc để nhìn thấy mình."}
            </p>
            <button
              onClick={() => setReduced((value) => !value)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-[12px] border border-[#cfc5b7] bg-[#f4f0e8] py-2.5 text-[12px] font-bold text-[#263b54] transition-colors hover:bg-[#fbf9f4]"
            >
              {reduced ? <RotateCcw size={14} /> : <Pause size={14} />}
              {reduced ? "Trở lại nhịp bình thường" : "Reduce Load"}
            </button>
          </aside>
        </section>

        <section>
          <div className="mb-3 flex items-end justify-between px-1">
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6d7480]">Lịch trình hôm nay</div>
              <p className="mt-1 text-[13px] text-[#8a919a]">Mở từng checkpoint khi bạn tới đó.</p>
            </div>
            <button
              onClick={() => setExpanded(expanded === null ? 1 : null)}
              className="flex items-center gap-1 text-[12px] font-semibold text-[#205248]"
            >
              {expanded === null ? "Mở timeline" : "Thu gọn"} <ChevronDown size={14} className={expanded === null ? "" : "rotate-180"} />
            </button>
          </div>

          <div className="relative">
            <div className="absolute bottom-6 left-[72px] top-6 hidden w-px bg-[#d8d0c3] sm:block" />
            <div className="space-y-2.5">
              {checkpoints.map((checkpoint, index) => {
                const Icon = checkpoint.icon;
                const isExpanded = expanded === index;
                const isCurrent = checkpoint.status === "current";
                const isDone = checkpoint.status === "done" || (isCurrent && choice !== null);

                return (
                  <article key={checkpoint.time} className="relative grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:gap-4">
                    <div className="hidden pt-5 text-right sm:block">
                      <div className={`font-mono text-[12px] font-bold ${isCurrent ? "text-[#205248]" : "text-[#6d7480]"}`}>{checkpoint.time}</div>
                    </div>
                    <button
                      onClick={() => toggleCheckpoint(index)}
                      aria-expanded={isExpanded}
                      className={`group relative w-full rounded-[18px] border p-4 text-left transition-colors sm:p-5 ${
                        isCurrent
                          ? "border-[#b8d0c8] bg-[#fbf9f4] shadow-[0_10px_25px_rgba(32,82,72,.07)]"
                          : "border-[#d8d0c3] bg-[#fbf9f4] hover:border-[#c8bcae]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-[12px] ${
                            isDone ? "bg-[#1d3557] text-[#fbf9f4]" : isCurrent ? "bg-[#dde8e4] text-[#205248]" : "bg-[#e8e1d5] text-[#6d7480]"
                          }`}
                        >
                          {isDone ? <Check size={16} /> : <Icon size={16} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-mono text-[10px] font-bold tracking-[.14em] text-[#8a919a] sm:hidden">{checkpoint.time}</span>
                            <span className={`font-mono text-[9px] font-bold tracking-[.15em] ${isCurrent ? "text-[#205248]" : "text-[#8a919a]"}`}>{checkpoint.period}</span>
                            {isCurrent && <span className="rounded-full bg-[#f0e1d3] px-2 py-0.5 text-[9px] font-bold text-[#8b5734]">ĐANG Ở ĐÂY</span>}
                          </div>
                          <h3 className={`mt-1 text-[15px] font-bold tracking-[-.015em] ${isCurrent ? "text-[#17263a]" : "text-[#263b54]"}`}>{checkpoint.title}</h3>
                          {isExpanded && <p className="mt-2 max-w-[610px] text-[12px] leading-[1.5] text-[#6d7480]">{checkpoint.note}</p>}
                        </div>
                        <ChevronDown size={16} className={`mt-1 shrink-0 text-[#8a919a] transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </div>
                      {isExpanded && (
                        <div className="mt-4 flex items-center justify-between border-t border-[#e8e1d5] pt-3">
                          <span className="flex items-center gap-1.5 text-[11px] text-[#8a919a]">
                            {isDone ? <Check size={13} className="text-[#205248]" /> : <Circle size={11} />}
                            {isDone ? "Đã ghi vào ngày hôm nay" : "Checkpoint sẽ mở khi tới giờ"}
                          </span>
                          {checkpoint.action && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (isCurrent) choose("accept");
                                else setExpanded(index);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (isCurrent) choose("accept");
                                }
                              }}
                              className={`flex items-center gap-1 text-[11px] font-bold ${isCurrent ? "text-[#205248]" : "text-[#6d7480]"}`}
                            >
                              {checkpoint.action} <ArrowRight size={13} />
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <footer className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-[#d8d0c3] px-1 pt-4 text-[11px] text-[#8a919a] sm:flex-row">
          <span className="flex items-center gap-1.5"><ShieldCheck size={13} /> GỢI Ý CÓ THỂ SAI</span>
          <button onClick={() => setQuiet((value) => !value)} className="font-bold text-[#205248]">
            {quiet ? "Silence" : "Recommendation"} đang bật
          </button>
        </footer>
      </div>
    </main>
  );
}

export default TodayDecisionTimeline;