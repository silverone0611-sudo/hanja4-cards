import { useEffect, useMemo, useState } from "react";
import allCards from "./data/hanja4_cards.json";

/* ===== 설정 ===== */
const DAILY_BASE_COUNT = 50;
const EXTRA_RANDOM_OPTIONS = [10, 20, 30];
const EXTRA_WRONG_MAX = 30;

const STORAGE_PROGRESS = "hanja_progress";
const STORAGE_TODAY = "hanja_today_set";
const STORAGE_DAYLY_LOG = "hanja_dayly_log"; // (유지: 이전 버전 호환/확장용)

/* ===== UI 고정 ===== */
const CONTENT_W = 640; // 프레임/카드 기준 폭
const CARD_H = 340;
const FRAME_PAD = 18;

/* ===== 날짜 유틸 ===== */
function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// 월요일 시작 주차 키
function weekKeyFromDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0(일)~6(토)
  const diffToMon = (day + 6) % 7; // 월=0
  dt.setDate(dt.getDate() - diffToMon);

  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function currentWeekKey() {
  return weekKeyFromDateStr(todayKey());
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ===== 저장/불러오기 ===== */
function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_PROGRESS)) || {};
  } catch {
    return {};
  }
}
function saveProgress(progress) {
  localStorage.setItem(STORAGE_PROGRESS, JSON.stringify(progress));
}
function loadTodaySet() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_TODAY)) || null;
  } catch {
    return null;
  }
}
function saveTodaySet(obj) {
  localStorage.setItem(STORAGE_TODAY, JSON.stringify(obj));
}

/* ===== 오늘 기본 50장 생성(“앎” 제외) ===== */
function buildTodaySet(progress, all) {
  const date = todayKey();

  const pool = all.map((c) => c.id).filter((id) => progress?.[id]?.known !== true);
  const ids = shuffle(pool).slice(0, DAILY_BASE_COUNT);

  return {
    date,
    main: {
      ids,
      cursor: 0,
      results: {}, // { [id]: "known" | "unknown" }
      baseCount: ids.length,
      baseCompleted: false,
      paused: false,
    },
    extra: null, // { type: "random" | "wrong", ids, cursor, results }
    finalEnded: false,
  };
}

function formatLine(card) {
  return `${card.character} (${card.sound}) - ${card.meaning} · 부수:${card.base} · 총획:${card.total}`;
}

/* ===== 마이그레이션(예전 형식 대응) ===== */
function migrateSavedTodaySet(saved, progress, all) {
  if (saved?.main && typeof saved?.finalEnded === "boolean") return saved;

  if (
    saved &&
    saved.date === todayKey() &&
    Array.isArray(saved.ids) &&
    typeof saved.cursor === "number"
  ) {
    const baseCount = saved.baseCount ?? Math.min(saved.ids.length, DAILY_BASE_COUNT);
    const baseCompleted = saved.baseCompleted ?? saved.cursor >= baseCount;
    const paused = saved.paused ?? false;
    return {
      date: saved.date,
      main: {
        ids: saved.ids,
        cursor: saved.cursor,
        results: saved.results || {},
        baseCount,
        baseCompleted,
        paused,
      },
      extra: null,
      finalEnded: false,
    };
  }

  return buildTodaySet(progress, all);
}

/* ===== 통계 계산 ===== */
function computeStats(progress) {
  const entries = Object.entries(progress || {});
  const reviewed = entries.filter(([, v]) => !!v?.reviewedAt);
  const known = entries.filter(([, v]) => v?.known === true);
  const unknown = entries.filter(([, v]) => v?.reviewedAt && v?.known !== true);

  const today = todayKey();
  const thisWeek = currentWeekKey();

  const reviewedToday = reviewed.filter(([, v]) => v?.lastReviewedDate === today);
  const knownToday = reviewedToday.filter(([, v]) => v?.known === true);
  const unknownToday = reviewedToday.filter(([, v]) => v?.known !== true);

  const reviewedThisWeek = reviewed.filter(([, v]) => {
    const d = v?.lastReviewedDate;
    if (!d) return false;
    return weekKeyFromDateStr(d) === thisWeek;
  });
  const knownThisWeek = reviewedThisWeek.filter(([, v]) => v?.known === true);
  const unknownThisWeek = reviewedThisWeek.filter(([, v]) => v?.known !== true);

  const byDate = {};
  for (const [, v] of reviewed) {
    const d = v.lastReviewedDate;
    if (!d) continue;
    byDate[d] = byDate[d] || { reviewed: 0, known: 0, unknown: 0 };
    byDate[d].reviewed += 1;
    if (v.known) byDate[d].known += 1;
    else byDate[d].unknown += 1;
  }

  return {
    total: { reviewed: reviewed.length, known: known.length, unknown: unknown.length },
    today: { reviewed: reviewedToday.length, known: knownToday.length, unknown: unknownToday.length },
    week: { reviewed: reviewedThisWeek.length, known: knownThisWeek.length, unknown: unknownThisWeek.length },
    byDate,
  };
}

/* ===== 오늘(todaySet) 기준: 앎/모름 목록 (main+extra 통합) ===== */
function getTodayVerdicts(todaySet) {
  const mainIds = todaySet?.main?.ids || [];
  const mainResults = todaySet?.main?.results || {};
  const extraIds = todaySet?.extra?.ids || [];
  const extraResults = todaySet?.extra?.results || {};

  const known = [];
  const unknown = [];

  for (const id of mainIds) {
    const r = mainResults[id];
    if (r === "known") known.push(id);
    else if (r === "unknown") unknown.push(id);
  }

  for (const id of extraIds) {
    const r = extraResults[id];
    if (r === "known") known.push(id);
    else if (r === "unknown") unknown.push(id);
  }

  return { known, unknown };
}

/* ===== progress 기준: 특정 날짜의 앎/모름 목록 ===== */
function getIdsByDateFromProgress(progress, dateStr) {
  const items = Object.entries(progress || {})
    .filter(([, v]) => v?.lastReviewedDate === dateStr && !!v?.reviewedAt)
    .map(([id, v]) => ({ id, v }));

  items.sort((a, b) => {
    const ta = a.v?.reviewedAt ? new Date(a.v.reviewedAt).getTime() : 0;
    const tb = b.v?.reviewedAt ? new Date(b.v.reviewedAt).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });

  const known = [];
  const unknown = [];
  for (const it of items) {
    if (it.v?.known === true) known.push(it.id);
    else unknown.push(it.id);
  }
  return { known, unknown, total: items.length };
}

export default function App() {
  const ALL = allCards;

  const [progress, setProgress] = useState(loadProgress);
  const [todaySet, setTodaySet] = useState(() => loadTodaySet());
  const [flipped, setFlipped] = useState(false);

  // home | study | pause | summary | final | today_known | today_unknown | dates | date_known | date_unknown
  const [screen, setScreen] = useState("home");
  const [selectedDate, setSelectedDate] = useState(null);

  // 페이지(이전/다음)
  const [pageIdx, setPageIdx] = useState(0);

  // 초기 로드
  useEffect(() => {
    const today = todayKey();
    const saved = loadTodaySet();
    let next;
    if (saved && saved.date === today) next = migrateSavedTodaySet(saved, progress, ALL);
    else next = buildTodaySet(progress, ALL);
    saveTodaySet(next);
    setTodaySet(next);
    setScreen("home");
    setFlipped(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 저장
  useEffect(() => saveProgress(progress), [progress]);
  useEffect(() => {
    if (todaySet) saveTodaySet(todaySet);
  }, [todaySet]);

  // id → card map
  const cardMap = useMemo(() => {
    const m = new Map();
    for (const c of ALL) m.set(c.id, c);
    return m;
  }, [ALL]);

  const stats = useMemo(() => computeStats(progress), [progress]);

  // ✅ 날짜 목록(최신순) — 훅은 최상단에서만!
  const dateKeys = useMemo(() => {
    const keys = Object.keys(stats.byDate || {});
    keys.sort((a, b) => b.localeCompare(a));
    return keys;
  }, [stats.byDate]);

  if (!todaySet) return <div style={{ padding: 24 }}>불러오는 중...</div>;

  const { main, extra, finalEnded } = todaySet;

  const mainIds = main?.ids || [];
  const mainCursor = main?.cursor ?? 0;
  const baseCount = main?.baseCount ?? Math.min(mainIds.length, DAILY_BASE_COUNT);
  const baseCompleted = main?.baseCompleted === true;
  const paused = main?.paused === true;

  const inExtra = !!extra;
  const activeIds = inExtra ? extra.ids : mainIds;
  const activeCursor = inExtra ? extra.cursor : mainCursor;

  const currentId = activeIds[activeCursor];
  const card = currentId ? cardMap.get(currentId) : null;

  const activeDone = activeIds.length > 0 && activeCursor >= activeIds.length;
  const shouldShowSummary = baseCompleted || (inExtra && activeDone);

  function writeProgressMark(id, isKnown) {
    const d = todayKey();
    setProgress((p) => {
      const prev = p[id] || {};
      return {
        ...p,
        [id]: {
          ...prev,
          known: isKnown ? true : prev.known === true ? true : false,
          lastReviewedDate: d,
          reviewedAt: new Date().toISOString(),
        },
      };
    });

    try {
      const raw = localStorage.getItem(STORAGE_DAYLY_LOG);
      const log = raw ? JSON.parse(raw) : {};
      log[d] = log[d] || { touchedAt: new Date().toISOString() };
      localStorage.setItem(STORAGE_DAYLY_LOG, JSON.stringify(log));
    } catch {}
  }

  function mark(isKnown) {
    if (!currentId) return;
    const verdict = isKnown ? "known" : "unknown";

    writeProgressMark(currentId, isKnown);
    setTodaySet((s) => {
      if (!s) return s;

      if (s.extra) {
        const nextCursor = s.extra.cursor + 1;
        return {
          ...s,
          main: { ...s.main, paused: false },
          extra: {
            ...s.extra,
            cursor: nextCursor,
            results: { ...s.extra.results, [currentId]: verdict },
          },
        };
      } else {
        const nextCursor = s.main.cursor + 1;
        const nextBaseCompleted = s.main.baseCompleted || nextCursor >= s.main.baseCount;
        return {
          ...s,
          main: {
            ...s.main,
            cursor: nextCursor,
            paused: false,
            baseCompleted: nextBaseCompleted,
            results: { ...s.main.results, [currentId]: verdict },
          },
        };
      }
    });
    setFlipped(false);
  }

  function endStudyNow() {
    setFlipped(false);
    setTodaySet((s) => {
      if (!s) return s;
      if (s.extra) return { ...s, extra: { ...s.extra, cursor: s.extra.ids.length } };

      const isBaseDoneNow = s.main.baseCompleted || s.main.cursor >= s.main.baseCount;
      if (isBaseDoneNow) return { ...s, main: { ...s.main, baseCompleted: true, paused: false } };
      return { ...s, main: { ...s.main, paused: true } };
    });
    setScreen("pause");
  }

  function resumeMain() {
    setFlipped(false);
    setTodaySet((s) => ({ ...s, main: { ...s.main, paused: false } }));
    setScreen("study");
  }

  function startExtraRandom(amount) {
    setFlipped(false);
    setTodaySet((s) => {
      if (!s) return s;

      const already = new Set(s.main.ids);
      if (s.extra?.ids) s.extra.ids.forEach((id) => already.add(id));

      const pool = ALL.map((c) => c.id).filter(
        (id) => progress?.[id]?.known !== true && !already.has(id)
      );
      const picked = shuffle(pool).slice(0, amount);

      return {
        ...s,
        main: { ...s.main, baseCompleted: true, paused: false },
        extra: { type: "random", ids: picked, cursor: 0, results: {} },
      };
    });
    setScreen("study");
  }

  function startExtraWrongOnly() {
    setFlipped(false);
    setTodaySet((s) => {
      if (!s) return s;
      const wrongAll = s.main.ids.filter((id) => s.main.results?.[id] === "unknown");
      const wrongPool = wrongAll.filter((id) => progress?.[id]?.known !== true);
      const picked = shuffle(wrongPool).slice(0, EXTRA_WRONG_MAX);

      return {
        ...s,
        main: { ...s.main, baseCompleted: true, paused: false },
        extra: { type: "wrong", ids: picked, cursor: 0, results: {} },
      };
    });
    setScreen("study");
  }

  function finalizeToday() {
    setFlipped(false);
    setTodaySet((s) => ({
      ...s,
      finalEnded: true,
      extra: null,
      main: { ...s.main, baseCompleted: true, paused: false },
    }));
    setScreen("final");
  }

  /* ===== 리셋 ===== */
  function resetTodayOnly() {
    const ok = window.confirm("오늘 학습(오늘 진행한 기록/세트)만 초기화할까요?");
    if (!ok) return;

    const t = todayKey();
    setProgress((p) => {
      const next = { ...p };
      for (const [id, v] of Object.entries(next)) {
        if (v?.lastReviewedDate === t) delete next[id];
      }
      return next;
    });

    const fresh = buildTodaySet(loadProgress(), ALL);
    saveTodaySet(fresh);
    setTodaySet(fresh);

    setSelectedDate(null);
    setPageIdx(0);
    setFlipped(false);
    setScreen("home");
  }

  function resetThisWeekOnly() {
    const ok = window.confirm("이번 주 학습 기록만 초기화할까요? (월요일~오늘)");
    if (!ok) return;

    const wk = currentWeekKey();
    setProgress((p) => {
      const next = { ...p };
      for (const [id, v] of Object.entries(next)) {
        const d = v?.lastReviewedDate;
        if (d && weekKeyFromDateStr(d) === wk) delete next[id];
      }
      return next;
    });

    const fresh = buildTodaySet(loadProgress(), ALL);
    saveTodaySet(fresh);
    setTodaySet(fresh);

    setSelectedDate(null);
    setPageIdx(0);
    setFlipped(false);
    setScreen("home");
  }

  function resetAllStudy() {
    const ok = window.confirm("전체 학습 기록을 모두 삭제하고 처음부터 시작할까요?");
    if (!ok) return;

    localStorage.removeItem(STORAGE_PROGRESS);
    localStorage.removeItem(STORAGE_TODAY);

    setProgress({});
    const fresh = buildTodaySet({}, ALL);
    saveTodaySet(fresh);
    setTodaySet(fresh);

    setSelectedDate(null);
    setPageIdx(0);
    setFlipped(false);
    setScreen("home");
  }

  const summary = useMemo(() => {
    const baseDone = Math.min(mainCursor, baseCount);
    const remaining = Math.max(0, baseCount - mainCursor);

    const todayVerdicts = getTodayVerdicts(todaySet);
    const wrongAvailable = todayVerdicts.unknown.filter((id) => progress?.[id]?.known !== true).length;

    return {
      knownCount: todayVerdicts.known.length,
      unknownCount: todayVerdicts.unknown.length,
      doneCount: baseDone,
      remainingCount: remaining,
      wrongAvailable,
    };
  }, [todaySet, mainCursor, baseCount, progress]);

  useEffect(() => {
    if (finalEnded) {
      setScreen("final");
      return;
    }
    if (paused && !baseCompleted) {
      if (screen !== "pause" && screen !== "home") setScreen("pause");
      return;
    }
    if (shouldShowSummary) {
      if (screen === "study") setScreen("summary");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalEnded, paused, baseCompleted, shouldShowSummary]);

  function ListPager({ title, ids, onBack, onGoOther }) {
    const total = ids.length;
    const safeIdx = Math.min(Math.max(0, pageIdx), Math.max(0, total - 1));
    const id = total ? ids[safeIdx] : null;
    const c = id ? cardMap.get(id) : null;

    useEffect(() => {
      if (pageIdx !== safeIdx) setPageIdx(safeIdx);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [total]);

    return (
      <div style={styles.app}>
        <div style={styles.frame}>
          <div style={styles.panel}>
            <div style={styles.panelHeaderRow}>
              <div>
                <div style={styles.panelKicker}>List</div>
                <div style={styles.panelTitle}>{title}</div>
                <div style={styles.panelSub}>
                  {total ? `${safeIdx + 1} / ${total}` : "목록이 비어 있어요."}
                </div>
              </div>
              <button style={styles.topLink} onClick={onBack}>
                뒤로
              </button>
            </div>

            <div style={styles.listPagerCard}>
              {c ? (
                <>
                  <div style={styles.listHanja}>{c.character}</div>
                  <div style={styles.listReading}>{c.sound}</div>
                  <div style={styles.listMeaning}>뜻: {c.meaning}</div>
                  <div style={styles.listSubinfo}>
                    부수: {c.base} · 총획: {c.total}
                  </div>
                  <div style={styles.listLine}>{formatLine(c)}</div>
                </>
              ) : (
                <div style={styles.empty}>표시할 항목이 없습니다.</div>
              )}
            </div>

            <div style={styles.pagerRow}>
              <button
                style={{ ...styles.smallBtn, opacity: total && safeIdx > 0 ? 1 : 0.45 }}
                onClick={() => total && safeIdx > 0 && setPageIdx(safeIdx - 1)}
                disabled={!total || safeIdx <= 0}
              >
                이전
              </button>
              <button
                style={{ ...styles.smallBtn, opacity: total && safeIdx < total - 1 ? 1 : 0.45 }}
                onClick={() => total && safeIdx < total - 1 && setPageIdx(safeIdx + 1)}
                disabled={!total || safeIdx >= total - 1}
              >
                다음
              </button>
              {onGoOther ? (
                <button style={styles.endBtn} onClick={onGoOther}>
                  반대 목록 보기
                </button>
              ) : null}
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <button style={styles.topLink} onClick={() => setScreen("home")}>
                홈
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ========================= HOME ========================= */
  if (screen === "home") {
    const statusText = finalEnded
      ? "오늘 학습은 이미 종료되었습니다."
      : paused && !baseCompleted
      ? `일시정지됨 · ${summary.doneCount}/${baseCount} 진행`
      : baseCompleted
      ? "기본 50장을 완료했습니다. 요약에서 ‘학습 종료’로 마감하세요."
      : `진행 중 · ${summary.doneCount}/${baseCount}`;

    return (
      <div style={styles.app}>
        <div style={styles.frame}>
          <div style={styles.hero}>
            <div style={styles.badge}>KOREAN HANJA · 4급</div>

            <h1 style={styles.heroTitle}>
              한국어문회 4급 대비
              <br />
              <span style={styles.heroTitleAccent}>한자 카드</span>
            </h1>

            <p style={styles.heroSub}>
              하루 {DAILY_BASE_COUNT}자 · 반드시 “앎/모름”으로 진행 · “앎”은 내일 출제 제외
            </p>

            <div style={styles.statusPill}>{statusText}</div>

            <div style={styles.statsBox}>
              <div style={styles.statsTitle}>누적 학습 통계</div>
              <div style={styles.statsGrid}>
                <div style={styles.statMini}>
                  <div style={styles.statMiniLabel}>전체</div>
                  <div style={styles.statMiniValue}>
                    학습 {stats.total.reviewed} · 앎 {stats.total.known} · 모름 {stats.total.unknown}
                  </div>
                </div>
                <div style={styles.statMini}>
                  <div style={styles.statMiniLabel}>오늘</div>
                  <div style={styles.statMiniValue}>
                    학습 {stats.today.reviewed} · 앎 {stats.today.known} · 모름 {stats.today.unknown}
                  </div>
                </div>
                <div style={styles.statMini}>
                  <div style={styles.statMiniLabel}>이번주</div>
                  <div style={styles.statMiniValue}>
                    학습 {stats.week.reviewed} · 앎 {stats.week.known} · 모름 {stats.week.unknown}
                  </div>
                </div>
              </div>
            </div>

            <div style={styles.homeActions}>
              {!finalEnded && paused && !baseCompleted && (
                <button style={styles.primaryBtn} onClick={resumeMain}>
                  이어서 학습하기
                </button>
              )}

              {!finalEnded && !paused && !baseCompleted && (
                <button style={styles.primaryBtn} onClick={() => setScreen("study")}>
                  오늘 학습 시작
                </button>
              )}

              {!finalEnded && baseCompleted && (
                <button style={styles.primaryBtn} onClick={() => setScreen("summary")}>
                  오늘 요약 / 마감
                </button>
              )}

              {finalEnded && (
                <button style={styles.primaryBtn} onClick={() => setScreen("final")}>
                  종료 화면 보기
                </button>
              )}

              <button
                style={styles.primaryBtn}
                onClick={() => {
                  setSelectedDate(null);
                  setPageIdx(0);
                  setScreen("dates");
                }}
              >
                날짜별 학습 요약 보기
              </button>
            </div>

            <div style={styles.resetBox}>
              <div style={styles.resetTitle}>리셋</div>
              <div style={styles.resetGrid}>
                <button style={styles.resetBtn} onClick={resetTodayOnly}>
                  오늘만 리셋
                </button>
                <button style={styles.resetBtn} onClick={resetThisWeekOnly}>
                  이번주만 리셋
                </button>
                <button style={styles.resetBtnDanger} onClick={resetAllStudy}>
                  전체 학습 리셋
                </button>
              </div>
              <div style={styles.resetNote}>* “오늘만/이번주만”은 해당 기간에 기록된 학습 로그를 삭제합니다.</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ========================= FINAL ========================= */
  if (screen === "final") {
    return (
      <div style={styles.app}>
        <div style={styles.frame}>
          <div style={styles.panel}>
            <div style={styles.finalIcon}>✅</div>
            <div style={styles.finalTitle}>오늘 학습을 모두 마쳤습니다</div>
            <p style={styles.finalSub}>내일 접속하면 “앎”으로 표시한 글자는 제외되고 랜덤으로 출제됩니다.</p>

            <div style={{ marginTop: 12 }}>
              <button style={styles.primaryBtn} onClick={() => setScreen("home")}>
                시작 화면으로
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ========================= PAUSE ========================= */
  if (screen === "pause" && paused && !baseCompleted) {
    return (
      <div style={styles.app}>
        <div style={styles.frame}>
          <div style={styles.panel}>
            <div style={styles.panelHeaderRow}>
              <div>
                <div style={styles.panelKicker}>Paused</div>
                <div style={styles.panelTitle}>오늘 학습이 일시정지 상태예요</div>
              </div>
              <button style={styles.topLink} onClick={() => setScreen("home")}>
                홈
              </button>
            </div>

            <div style={styles.statCardRow}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>진행</div>
                <div style={styles.statValue}>
                  {summary.doneCount} / {baseCount}
                </div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>남은 글자</div>
                <div style={styles.statValue}>{summary.remainingCount}</div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <button style={styles.primaryBtn} onClick={resumeMain}>
                이어서 학습하기
              </button>
            </div>

            <div style={{ marginTop: 14 }}>
              <button style={styles.resetBtnDanger} onClick={resetAllStudy}>
                전체 학습 리셋
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ========================= SUMMARY ========================= */
  if (screen === "summary" && shouldShowSummary) {
    const canWrong = summary.wrongAvailable > 0;

    return (
      <div style={styles.app}>
        <div style={styles.frame}>
          <div style={styles.panel}>
            <div style={styles.panelHeaderRow}>
              <div>
                <div style={styles.panelKicker}>Summary</div>
                <div style={styles.panelTitle}>오늘 {todayKey()} 학습 요약</div>
                <div style={styles.panelSub}>* 여기서 “학습 종료”를 눌러야 오늘이 마감됩니다.</div>
              </div>
              <button style={styles.topLink} onClick={() => setScreen("home")}>
                홈
              </button>
            </div>

            <div style={{ ...styles.statsBox, marginTop: 0 }}>
              <div style={styles.statsTitle}>누적 학습 통계</div>
              <div style={styles.statsGrid}>
                <div style={styles.statMini}>
                  <div style={styles.statMiniLabel}>전체</div>
                  <div style={styles.statMiniValue}>
                    학습 {stats.total.reviewed} · 앎 {stats.total.known} · 모름 {stats.total.unknown}
                  </div>
                </div>
                <div style={styles.statMini}>
                  <div style={styles.statMiniLabel}>오늘</div>
                  <div style={styles.statMiniValue}>
                    학습 {stats.today.reviewed} · 앎 {stats.today.known} · 모름 {stats.today.unknown}
                  </div>
                </div>
                <div style={styles.statMini}>
                  <div style={styles.statMiniLabel}>이번주</div>
                  <div style={styles.statMiniValue}>
                    학습 {stats.week.reviewed} · 앎 {stats.week.known} · 모름 {stats.week.unknown}
                  </div>
                </div>
              </div>
            </div>

            <div style={styles.statCardRow3}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>앎</div>
                <div style={styles.statValue}>{summary.knownCount}</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>모름</div>
                <div style={styles.statValue}>{summary.unknownCount}</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>오답 추가학습</div>
                <div style={styles.statValue}>{summary.wrongAvailable}</div>
              </div>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <button
                style={styles.primaryBtn}
                onClick={() => {
                  setPageIdx(0);
                  setScreen("today_known");
                }}
              >
                오늘 “앎” 보기
              </button>
              <button
                style={styles.primaryBtn}
                onClick={() => {
                  setPageIdx(0);
                  setScreen("today_unknown");
                }}
              >
                오늘 “모름” 보기
              </button>
            </div>

            <div style={styles.actionRow}>
              {EXTRA_RANDOM_OPTIONS.map((n) => (
                <button key={n} onClick={() => startExtraRandom(n)} style={styles.smallBtn}>
                  추가학습 {n}
                </button>
              ))}
              <button
                onClick={startExtraWrongOnly}
                style={{ ...styles.smallBtn, opacity: canWrong ? 1 : 0.45 }}
                disabled={!canWrong}
              >
                오답만
              </button>
              <button onClick={finalizeToday} style={styles.endBtn}>
                학습 종료
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              <button
                style={styles.topLink}
                onClick={() => {
                  setSelectedDate(null);
                  setPageIdx(0);
                  setScreen("dates");
                }}
              >
                날짜별 학습 요약 보기
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ========================= TODAY KNOWN / UNKNOWN ========================= */
  if (screen === "today_known") {
    const { known } = getTodayVerdicts(todaySet);
    return (
      <ListPager
        title={`오늘 ${todayKey()} “앎”`}
        ids={known}
        onBack={() => setScreen("summary")}
        onGoOther={() => {
          setPageIdx(0);
          setScreen("today_unknown");
        }}
      />
    );
  }

  if (screen === "today_unknown") {
    const { unknown } = getTodayVerdicts(todaySet);
    return (
      <ListPager
        title={`오늘 ${todayKey()} “모름”`}
        ids={unknown}
        onBack={() => setScreen("summary")}
        onGoOther={() => {
          setPageIdx(0);
          setScreen("today_known");
        }}
      />
    );
  }

  /* ========================= DATES ========================= */
  if (screen === "dates") {
    return (
      <div style={styles.app}>
        <div style={styles.frame}>
          <div style={styles.panel}>
            <div style={styles.panelHeaderRow}>
              <div>
                <div style={styles.panelKicker}>History</div>
                <div style={styles.panelTitle}>날짜별 학습 요약</div>
                <div style={styles.panelSub}>날짜를 선택하면 “앎/모름” 페이지로 이동합니다.</div>
              </div>

              {/* ✅ 항상 보이는 홈 버튼 */}
              <button style={styles.topLink} onClick={() => setScreen("home")}>
                홈
              </button>
            </div>

            <div style={styles.dateListBox}>
              {dateKeys.length ? (
                dateKeys.map((d) => {
                  const row = stats.byDate[d];
                  return (
                    <button
                      key={d}
                      style={styles.dateRowBtn}
                      onClick={() => {
                        setSelectedDate(d);
                        setPageIdx(0);
                        setScreen("date_known");
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontWeight: 900 }}>{d}</div>
                        <div style={{ opacity: 0.85, fontSize: 12 }}>
                          학습 {row.reviewed} · 앎 {row.known} · 모름 {row.unknown}
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div style={styles.empty}>아직 학습 기록이 없습니다.</div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <button style={styles.topLink} onClick={() => setScreen("home")}>
                홈으로
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ========================= DATE KNOWN / UNKNOWN ========================= */
  if (screen === "date_known") {
    const d = selectedDate || todayKey();
    const { known } = getIdsByDateFromProgress(progress, d);
    return (
      <ListPager
        title={`${d} “앎”`}
        ids={known}
        onBack={() => setScreen("dates")}
        onGoOther={() => {
          setPageIdx(0);
          setScreen("date_unknown");
        }}
      />
    );
  }

  if (screen === "date_unknown") {
    const d = selectedDate || todayKey();
    const { unknown } = getIdsByDateFromProgress(progress, d);
    return (
      <ListPager
        title={`${d} “모름”`}
        ids={unknown}
        onBack={() => setScreen("dates")}
        onGoOther={() => {
          setPageIdx(0);
          setScreen("date_known");
        }}
      />
    );
  }

  /* ========================= STUDY ========================= */
  if (screen === "study") {
    if (inExtra && activeDone) {
      return (
        <div style={styles.app}>
          <div style={styles.frame}>
            <div style={styles.panel}>
              <div style={styles.panelKicker}>Done</div>
              <div style={styles.panelTitle}>추가학습이 끝났어요</div>

              <div style={{ marginTop: 12 }}>
                <button style={styles.primaryBtn} onClick={() => setScreen("summary")}>
                  요약으로 돌아가기
                </button>
              </div>

              <div style={{ marginTop: 14 }}>
                <button style={styles.resetBtnDanger} onClick={resetAllStudy}>
                  전체 학습 리셋
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (!card) return <div style={{ padding: 24 }}>데이터 없음 / 로딩 중...</div>;

    const modeLabel = inExtra
      ? extra.type === "wrong"
        ? "추가학습 · 오답"
        : "추가학습"
      : "오늘 학습";
    const total = activeIds.length;

    return (
      <div style={styles.app}>
        <div style={styles.frame}>
          <div style={styles.studyTop}>
            <button style={styles.topLink} onClick={() => setScreen("home")}>
              홈
            </button>

            <div style={styles.studyMeta}>
              <div style={styles.studyMetaTitle}>{modeLabel}</div>
              <div style={styles.studyMetaSub}>
                {activeCursor + 1} / {total}
              </div>
            </div>

            <button onClick={endStudyNow} style={styles.smallEndBtn}>
              오늘 종료
            </button>
          </div>

          <div style={styles.card} onClick={() => setFlipped((v) => !v)}>
            <div style={styles.cardInner}>
              {!flipped ? (
                <div style={styles.faceFront}>
                  <div style={styles.hanja}>{card.character}</div>
                  <div style={styles.tapHint}>
                    <span>눌러서 뒤집기</span>
                    <span style={{ display: "block", textAlign: "center", opacity: 0.75 }}>
                      Tap to reveal
                    </span>
                  </div>
                </div>
              ) : (
                <div style={styles.faceBack}>
                  <div style={styles.reading}>{card.sound}</div>
                  <div style={styles.meaning}>뜻: {card.meaning}</div>
                  <div style={styles.subinfo}>
                    부수: {card.base} · 총획: {card.total}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={styles.buttons}>
            <button onClick={() => mark(false)} style={styles.unknownBtn}>
              모름
            </button>
            <button onClick={() => mark(true)} style={styles.knownBtn}>
              앎
            </button>
          </div>

          <div style={styles.studyFooter}>* 반드시 “앎/모름”을 눌러야 다음 카드로 이동합니다.</div>
        </div>
      </div>
    );
  }

  return null;
}

/* ===== 스타일 ===== */
const styles = {
  app: {
    minHeight: "100vh",
    width: "100vw",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background:
      "radial-gradient(1200px 600px at 20% 10%, rgba(255,255,255,0.12), rgba(255,255,255,0) 60%)," +
      "radial-gradient(900px 500px at 80% 20%, rgba(120,160,255,0.16), rgba(255,255,255,0) 55%)," +
      "linear-gradient(180deg, #0b1020 0%, #070a12 100%)",
    color: "#e9eefc",
    boxSizing: "border-box",
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", sans-serif',
  },

  frame: { width: "100%", maxWidth: CONTENT_W, margin: "0 auto", padding: "20px 0", boxSizing: "border-box" },

  hero: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 18,
    padding: FRAME_PAD,
    margin: "0 auto",
    background: "rgba(255,255,255,0.06)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
    backdropFilter: "blur(10px)",
  },

  panel: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 18,
    padding: FRAME_PAD,
    margin: "0 auto",
    background: "rgba(255,255,255,0.06)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
    backdropFilter: "blur(10px)",
  },

  badge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    letterSpacing: 0.6,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    opacity: 0.9,
    marginBottom: 10,
  },

  heroTitle: { margin: "10px 0 6px", fontSize: 30, lineHeight: 1.18, letterSpacing: -0.4 },
  heroTitleAccent: {
    display: "inline-block",
    background: "linear-gradient(90deg, rgba(160,210,255,0.95), rgba(255,255,255,0.95))",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  },
  heroSub: { margin: "0 0 14px", opacity: 0.78, fontSize: 13, lineHeight: 1.5 },

  statusPill: {
    display: "inline-flex",
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    fontSize: 12,
    opacity: 0.9,
    marginBottom: 14,
  },

  homeActions: { display: "grid", gap: 10 },
  primaryBtn: {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "linear-gradient(180deg, rgba(120,190,255,0.35), rgba(120,190,255,0.16))",
    color: "#f4f8ff",
    cursor: "pointer",
    fontWeight: 900,
    width: "100%",
  },

  statsBox: {
    marginTop: 12,
    marginBottom: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 14,
    padding: 14,
    background: "rgba(0,0,0,0.22)",
  },
  statsTitle: { fontWeight: 900, marginBottom: 10, letterSpacing: -0.1 },
  statsGrid: { display: "grid", gap: 8 },
  statMini: {
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 12,
    padding: 10,
    background: "rgba(255,255,255,0.04)",
  },
  statMiniLabel: { fontSize: 12, opacity: 0.8, marginBottom: 4 },
  statMiniValue: { fontSize: 13, opacity: 0.95, lineHeight: 1.4 },

  resetBox: {
    marginTop: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 14,
    padding: 14,
    background: "rgba(0,0,0,0.22)",
  },
  resetTitle: { fontWeight: 900, marginBottom: 10, letterSpacing: -0.1 },
  resetGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "center" },
  resetBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    color: "#f4f8ff",
    cursor: "pointer",
    fontWeight: 900,
  },
  resetBtnDanger: {
    gridColumn: "1 / -1",
    padding: "9px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,80,80,0.38)",
    background: "rgba(255,80,80,0.12)",
    color: "#ffdada",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    width: "fit-content",
    justifySelf: "end",
  },
  resetNote: { marginTop: 8, fontSize: 12, opacity: 0.7, lineHeight: 1.4 },

  panelHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "flex-start",
    marginBottom: 12,
  },
  panelKicker: { fontSize: 12, opacity: 0.75, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 },
  panelTitle: { fontSize: 18, fontWeight: 900, letterSpacing: -0.2 },
  panelSub: { fontSize: 12, opacity: 0.8, marginTop: 6, lineHeight: 1.5 },

  topLink: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#f4f8ff",
    cursor: "pointer",
    fontSize: 12,
    whiteSpace: "nowrap",
    opacity: 0.9,
  },

  statCardRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 },
  statCardRow3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 12 },

  statCard: { border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, padding: 12, background: "rgba(0,0,0,0.22)" },
  statLabel: { fontSize: 12, opacity: 0.75, marginBottom: 6 },
  statValue: { fontSize: 20, fontWeight: 900, letterSpacing: -0.3 },

  actionRow: { marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  smallBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    color: "#f4f8ff",
    cursor: "pointer",
    fontWeight: 900,
  },
  endBtn: {
    gridColumn: "1 / -1",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "linear-gradient(180deg, rgba(255,210,120,0.32), rgba(255,210,120,0.14))",
    color: "#fff7e7",
    cursor: "pointer",
    fontWeight: 900,
  },

  finalIcon: { fontSize: 34, marginBottom: 6, textAlign: "center" },
  finalTitle: { fontSize: 22, fontWeight: 900, letterSpacing: -0.2, margin: "6px 0 6px", textAlign: "center" },
  finalSub: { fontSize: 13, opacity: 0.8, lineHeight: 1.6, margin: 0, textAlign: "center" },

  studyTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 },
  studyMeta: { flex: 1, textAlign: "center" },
  studyMetaTitle: { fontWeight: 900, letterSpacing: -0.2 },
  studyMetaSub: { fontSize: 12, opacity: 0.75, marginTop: 4 },
  smallEndBtn: {
    padding: "9px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.22)",
    color: "#f4f8ff",
    cursor: "pointer",
    fontSize: 12,
    whiteSpace: "nowrap",
    opacity: 0.9,
  },

  card: {
    width: "100%",
    height: `${CARD_H}px`,
    margin: "0 auto 16px",
    padding: FRAME_PAD,
    boxSizing: "border-box",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 18,
    background: "rgba(255,255,255,0.06)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.38)",
    backdropFilter: "blur(10px)",
    cursor: "pointer",
    userSelect: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  cardInner: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" },

  faceFront: { width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 },
  faceBack: { width: "100%", height: "100%", overflowY: "auto", paddingRight: 6, boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center" },

  hanja: { fontSize: 104, fontWeight: 700, lineHeight: 1, letterSpacing: 1, fontFamily: '"신명조", "Batang", "바탕", serif', textShadow: "0 10px 28px rgba(0,0,0,0.35)" },
  tapHint: { fontSize: 12, opacity: 0.7, border: "1px solid rgba(255,255,255,0.12)", padding: "6px 10px", borderRadius: 999, background: "rgba(0,0,0,0.22)" },

  reading: { fontSize: 22, fontWeight: 900, letterSpacing: -0.2 },
  meaning: { fontSize: 16, opacity: 0.92 },
  subinfo: { fontSize: 13, opacity: 0.78 },

  buttons: { display: "flex", gap: 10, justifyContent: "center", marginBottom: 10 },
  unknownBtn: { padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(255,120,120,0.35)", background: "rgba(255,120,120,0.10)", color: "#ffecec", cursor: "pointer", fontWeight: 900, minWidth: 120 },
  knownBtn: { padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(120,255,180,0.30)", background: "rgba(120,255,180,0.10)", color: "#eafff2", cursor: "pointer", fontWeight: 900, minWidth: 120 },
  studyFooter: { fontSize: 12, opacity: 0.7, textAlign: "center" },

  listPagerCard: { border: "1px solid rgba(255,255,255,0.10)", borderRadius: 16, padding: 16, background: "rgba(0,0,0,0.22)", textAlign: "center" },
  listHanja: { fontSize: 84, fontWeight: 700, lineHeight: 1, letterSpacing: 1, fontFamily: '"신명조", "Batang", "바탕", serif', marginBottom: 8, textShadow: "0 10px 28px rgba(0,0,0,0.35)" },
  listReading: { fontSize: 18, fontWeight: 900, marginBottom: 6 },
  listMeaning: { fontSize: 14, opacity: 0.92, marginBottom: 8 },
  listSubinfo: { fontSize: 12, opacity: 0.78, marginBottom: 10 },
  listLine: { fontSize: 12, opacity: 0.75, borderTop: "1px solid rgba(255,255,255,0.10)", paddingTop: 10, marginTop: 10, lineHeight: 1.5, wordBreak: "keep-all", overflowWrap: "anywhere" },
  pagerRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 },

  dateListBox: { border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, padding: 12, background: "rgba(0,0,0,0.22)", display: "grid", gap: 10 },
  dateRowBtn: { padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#f4f8ff", cursor: "pointer", textAlign: "left" },

  empty: { fontSize: 13, opacity: 0.7 },
};
