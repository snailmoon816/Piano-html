import { useState, useEffect, useRef, useCallback } from "react";
import "./index.css";

// ===== TYPES =====
type Beat = string[];
type Mode = "free" | "auto" | "practice";
type Song = {
  id: string;
  name: string;
  content: string;
  completedCount: number;
  lastPlayed: string | null;
  totalHits: number;
  totalAttempts: number;
};

// ===== CONSTANTS =====
const HIGH_KEYS = ["Q", "W", "E", "R", "T", "Y", "U"];
const MID_KEYS  = ["A", "S", "D", "F", "G", "H", "J"];
const LOW_KEYS  = ["Z", "X", "C", "V", "B", "N", "M"];
const ALL_KEYS  = new Set([...HIGH_KEYS, ...MID_KEYS, ...LOW_KEYS]);

const KEY_FREQ: Record<string, number> = {
  Q: 1046.5, W: 1174.66, E: 1318.51, R: 1396.91, T: 1567.98, Y: 1760.0,  U: 1975.53,
  A: 523.25,  S: 587.33,  D: 659.25,  F: 698.46,  G: 783.99,  H: 880.0,   J: 987.77,
  Z: 261.63,  X: 293.66,  C: 329.63,  V: 349.23,  B: 392.0,   N: 440.0,   M: 493.88,
};

const KEY_OCTAVE: Record<string, "high" | "mid" | "low"> = {
  ...Object.fromEntries(HIGH_KEYS.map((k) => [k, "high" as const])),
  ...Object.fromEntries(MID_KEYS.map((k)  => [k, "mid"  as const])),
  ...Object.fromEntries(LOW_KEYS.map((k)  => [k, "low"  as const])),
};

// Jianpu (簡譜) numbers 1-7 per key
const JIANPU_NUM: Record<string, string> = {
  Q: "1", W: "2", E: "3", R: "4", T: "5", Y: "6", U: "7",
  A: "1", S: "2", D: "3", F: "4", G: "5", H: "6", J: "7",
  Z: "1", X: "2", C: "3", V: "4", B: "5", N: "6", M: "7",
};

// ===== AUDIO =====
let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playKey(key: string) {
  if (key === "-") return;
  const freq = KEY_FREQ[key];
  if (!freq) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = KEY_OCTAVE[key] === "mid" ? "triangle" : "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.45, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.9);
}

function playBeat(beat: Beat) { beat.forEach((k) => playKey(k)); }

// ===== SCORE PARSER =====
function parseScore(content: string): Beat[] {
  return content.trim().split(/\s+/).filter(Boolean).map((token) => {
    if (token === "-") return ["-"];
    const keys = token.toUpperCase().split("").filter((k) => ALL_KEYS.has(k));
    return keys.length > 0 ? keys : null;
  }).filter((b): b is Beat => b !== null);
}

// ===== LOCALSTORAGE =====
const LS_KEY = "genshin_piano_songs_v2";

function loadSongs(): Song[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
    const old = localStorage.getItem("genshin_piano_songs");
    if (old) {
      return JSON.parse(old).map((s: Song & { playCount?: number }) => ({
        ...s,
        completedCount: s.completedCount ?? s.playCount ?? 0,
      }));
    }
    return [];
  } catch { return []; }
}

function saveSongs(songs: Song[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(songs));
}

function makeSong(name: string, content: string): Song {
  return { id: crypto.randomUUID(), name, content, completedCount: 0, lastPlayed: null, totalHits: 0, totalAttempts: 0 };
}

function calcAccuracy(song: Song): number | null {
  if (song.totalAttempts === 0) return null;
  return Math.round((song.totalHits / song.totalAttempts) * 100);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ===== PIANO KEY =====
function PianoKey({ label, octave, highlighted, pressed, flashCorrect, flashWrong, onPress }: {
  label: string;
  octave: "high" | "mid" | "low";
  highlighted: boolean;
  pressed: boolean;
  flashCorrect: boolean;
  flashWrong: boolean;
  onPress: (key: string) => void;
}) {
  const cls = ["piano-key", `octave-${octave}`,
    highlighted ? "highlighted" : "",
    pressed      ? "pressed"     : "",
    flashCorrect && !flashWrong ? "correct-flash" : "",
    flashWrong   ? "wrong-flash" : "",
  ].filter(Boolean).join(" ");

  const num = JIANPU_NUM[label];

  return (
    <div className={cls} onPointerDown={(e) => { e.preventDefault(); onPress(label); }}>
      <span className="key-letter">{label}</span>
      <div className="jianpu-label">
        {octave === "high" && <span className="jianpu-dot">·</span>}
        <span className="jianpu-num">{num}</span>
        {octave === "low" && <span className="jianpu-dot">·</span>}
      </div>
    </div>
  );
}

// ===== NOTE BADGE =====
function NoteKeyBadge({ keys, size }: { keys: string[]; size: "big" | "small" }) {
  if (keys[0] === "-") {
    return size === "big"
      ? <div className="note-key-badge rest-badge">—</div>
      : <div className="next-key-small" style={{ color: "var(--rest-color)", fontSize: 14 }}>—</div>;
  }
  if (size === "big") {
    return (
      <div className="current-note">
        {keys.map((k) => (
          <div key={k} className={`note-key-badge octave-${KEY_OCTAVE[k]}`}>
            {k}<span className="note-label">{JIANPU_NUM[k]}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="next-note-badge">
      {keys.map((k) => <div key={k} className="next-key-small">{k}</div>)}
    </div>
  );
}

// ===== UPLOAD MODAL =====
function UploadModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, content: string) => void }) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!name) setName(file.name.replace(/\.txt$/i, ""));
    const reader = new FileReader();
    reader.onload = (ev) => setContent(ev.target?.result as string ?? "");
    reader.readAsText(file, "utf-8");
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || !content.trim()) return;
    onSave(trimmed, content);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>Upload Song</h3>
        <input type="text" placeholder="Song name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div style={{ marginBottom: 10 }}>
          <button className="ctrl-btn" style={{ width: "100%", justifyContent: "center", marginBottom: 8 }} onClick={() => fileRef.current?.click()}>
            📂 Choose .txt file
          </button>
          <input ref={fileRef} type="file" accept=".txt,text/plain" style={{ display: "none" }} onChange={handleFile} />
          {content && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-card)", borderRadius: 6, padding: "6px 8px", fontFamily: "monospace", maxHeight: 80, overflow: "auto" }}>
              {content.slice(0, 200)}{content.length > 200 ? "…" : ""}
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
          Format: <code style={{ color: "var(--accent)" }}>A S D Q Z</code> — space = separate beat,
          no-space = chord <code style={{ color: "var(--accent)" }}>AQ</code>, dash = rest <code style={{ color: "var(--accent)" }}>-</code>
        </div>
        <div className="modal-actions">
          <button className="ctrl-btn" onClick={onClose}>Cancel</button>
          <button className="ctrl-btn active" onClick={handleSave} disabled={!name.trim() || !content.trim()}>Save Song</button>
        </div>
      </div>
    </div>
  );
}

// ===== MAIN APP =====
export default function App() {
  const [songs, setSongs] = useState<Song[]>(loadSongs);
  const [activeSongId, setActiveSongId] = useState<string | null>(null);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [beatIndex, setBeatIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("free");
  const [bpm, setBpm] = useState(80);
  const [libraryOpen, setLibraryOpen] = useState(true);

  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  const [flashKeys, setFlashKeys] = useState<Map<string, "correct" | "wrong">>(new Map());
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [sessionHits, setSessionHits] = useState(0);
  const [sessionAttempts, setSessionAttempts] = useState(0);
  const [showUpload, setShowUpload] = useState(false);

  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const beatIndexRef = useRef(0);
  const beatsRef     = useRef<Beat[]>([]);
  const modeRef      = useRef<Mode>("free");
  const pendingRef   = useRef<Set<string>>(new Set());
  const scoreRef     = useRef<HTMLDivElement>(null);

  useEffect(() => { beatIndexRef.current = beatIndex; }, [beatIndex]);
  useEffect(() => { beatsRef.current = beats; }, [beats]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { pendingRef.current = pendingKeys; }, [pendingKeys]);
  useEffect(() => { saveSongs(songs); }, [songs]);

  useEffect(() => {
    const el = scoreRef.current?.querySelector(".beat-token.current") as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [beatIndex]);

  const highlightedKeys = new Set((beats[beatIndex] ?? []).filter((k) => k !== "-"));

  // ===== BEAT ADVANCEMENT =====
  const advanceBeat = useCallback((fromIndex: number, currentBeats: Beat[], onDone: (newIdx: number) => void) => {
    let next = fromIndex + 1;
    while (next < currentBeats.length && currentBeats[next]?.[0] === "-") next++;
    onDone(next);
  }, []);

  const onSongComplete = useCallback(() => {
    setMode("free"); modeRef.current = "free";
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setActiveSongId((id) => {
      if (id) setSongs((prev) => prev.map((s) => s.id === id
        ? { ...s, completedCount: s.completedCount + 1, lastPlayed: new Date().toISOString() } : s));
      return id;
    });
    setSessionHits((hits) => {
      setSessionAttempts((attempts) => {
        if (attempts > 0) {
          setActiveSongId((id) => {
            if (id) setSongs((prev) => prev.map((s) => s.id === id
              ? { ...s, totalHits: s.totalHits + hits, totalAttempts: s.totalAttempts + attempts } : s));
            return id;
          });
        }
        return attempts;
      });
      return hits;
    });
  }, []);

  const completeBeat = useCallback((beatIdx: number) => {
    const currentBeats = beatsRef.current;
    setSessionHits((h) => h + 1);
    setSessionAttempts((a) => a + 1);
    advanceBeat(beatIdx, currentBeats, (newIdx) => {
      setBeatIndex(newIdx); beatIndexRef.current = newIdx;
      if (newIdx >= currentBeats.length) {
        onSongComplete();
      } else {
        const next = currentBeats[newIdx] ?? [];
        const np = new Set(next.filter((k) => k !== "-"));
        setPendingKeys(np); pendingRef.current = np;
      }
    });
  }, [advanceBeat, onSongComplete]);

  // ===== FLASH HELPER =====
  const doFlashKey = useCallback((key: string, type: "correct" | "wrong") => {
    setFlashKeys((prev) => new Map([...prev, [key, type]]));
    setTimeout(() => setFlashKeys((prev) => { const n = new Map(prev); n.delete(key); return n; }), 200);
  }, []);

  // ===== KEY PRESS HANDLER =====
  const handlePianoKey = useCallback((key: string) => {
    getAudioCtx();
    playKey(key);
    doFlashKey(key, "correct");

    const currentMode   = modeRef.current;
    const currentBeats  = beatsRef.current;
    const currentIdx    = beatIndexRef.current;

    if (currentMode !== "practice" || currentBeats.length === 0) return;
    if (currentIdx >= currentBeats.length) return;

    const beat = currentBeats[currentIdx];
    if (!beat || beat[0] === "-") return;

    const pending = new Set(pendingRef.current);
    if (pending.has(key)) {
      pending.delete(key);
      setPendingKeys(new Set(pending)); pendingRef.current = new Set(pending);
      if (pending.size === 0) completeBeat(currentIdx);
    } else {
      doFlashKey(key, "wrong");
      setSessionAttempts((a) => a + 1);
    }
  }, [doFlashKey, completeBeat]);

  // ===== KEYBOARD EVENTS =====
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toUpperCase();
      if (!ALL_KEYS.has(key)) return;
      e.preventDefault();
      setPressedKeys((prev) => new Set([...prev, key]));
      handlePianoKey(key);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      setPressedKeys((prev) => { const n = new Set(prev); n.delete(e.key.toUpperCase()); return n; });
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [handlePianoKey]);

  // ===== SONG / MODE CONTROLS =====
  function loadSong(song: Song) {
    stopAll();
    const parsed = parseScore(song.content);
    setBeats(parsed); beatsRef.current = parsed;
    setBeatIndex(0); beatIndexRef.current = 0;
    setActiveSongId(song.id);
    setSessionHits(0); setSessionAttempts(0);
    setPendingKeys(new Set());
  }

  function stopAll() {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setMode("free"); modeRef.current = "free";
  }

  function startAutoPlay() {
    if (beats.length === 0) return;
    stopAll(); setMode("auto"); modeRef.current = "auto";
    getAudioCtx();
    const ms = Math.round(60000 / bpm);
    intervalRef.current = setInterval(() => {
      const idx = beatIndexRef.current;
      const currentBeats = beatsRef.current;
      if (idx >= currentBeats.length) { stopAll(); onSongComplete(); return; }
      playBeat(currentBeats[idx]);
      const next = idx + 1;
      setBeatIndex(next); beatIndexRef.current = next;
    }, ms);
  }

  function startPractice() {
    if (beats.length === 0) return;
    stopAll();
    let startIdx = beatIndex;
    while (startIdx < beats.length && beats[startIdx]?.[0] === "-") startIdx++;
    if (startIdx >= beats.length) { setBeatIndex(0); startIdx = 0; }
    setBeatIndex(startIdx); beatIndexRef.current = startIdx;
    const firstBeat = beats[startIdx] ?? [];
    const fp = new Set(firstBeat.filter((k) => k !== "-"));
    setPendingKeys(fp); pendingRef.current = fp;
    setMode("practice"); modeRef.current = "practice";
    getAudioCtx();
  }

  function restart() {
    stopAll(); setBeatIndex(0); beatIndexRef.current = 0;
    setSessionHits(0); setSessionAttempts(0); setPendingKeys(new Set());
  }

  function stepForward() {
    if (beats.length === 0 || mode !== "free") return;
    const beat = beats[beatIndex];
    if (beat) playBeat(beat);
    const next = Math.min(beatIndex + 1, beats.length);
    setBeatIndex(next); beatIndexRef.current = next;
  }

  function stepBack() {
    if (mode !== "free") return;
    const prev = Math.max(beatIndex - 1, 0);
    setBeatIndex(prev); beatIndexRef.current = prev;
  }

  function deleteSong(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSongs((prev) => prev.filter((s) => s.id !== id));
    if (activeSongId === id) { setActiveSongId(null); setBeats([]); setBeatIndex(0); stopAll(); }
  }

  // ===== DERIVED =====
  const activeSong    = songs.find((s) => s.id === activeSongId) ?? null;
  const currentBeat: Beat = beats[beatIndex] ?? [];
  const nextBeat: Beat    = beats[beatIndex + 1] ?? [];
  const progress          = beats.length > 0 ? Math.min(beatIndex / beats.length, 1) : 0;
  const isComplete        = beats.length > 0 && beatIndex >= beats.length;
  const sessionAcc        = sessionAttempts > 0 ? Math.round((sessionHits / sessionAttempts) * 100) : null;

  return (
    <div className="app">
      {/* TOP ROW: library + practice */}
      <div className="app-top">

        {/* ===== LIBRARY ===== */}
        <aside className={`library${libraryOpen ? "" : " collapsed"}`}>
          <div className="library-header">
            <h2>Songs</h2>
            <button className="upload-btn" onClick={() => setShowUpload(true)}>+ Upload</button>
          </div>
          <div className="song-list">
            {songs.length === 0 && (
              <div className="library-empty">
                <p>🎵</p>
                <p>No songs yet.<br />Upload a .txt score to start.</p>
              </div>
            )}
            {songs.map((song) => {
              const acc = calcAccuracy(song);
              return (
                <div key={song.id} className={`song-item${activeSongId === song.id ? " active" : ""}`} onClick={() => loadSong(song)}>
                  <div className="song-item-body">
                    <div className="song-name">{song.name}</div>
                    <div className="song-meta">
                      <span className="song-stat">✓ <span>{song.completedCount}</span></span>
                      {acc !== null && <span className="song-stat">🎯 <span>{acc}%</span></span>}
                      <span className="song-stat">🕐 <span>{fmtDate(song.lastPlayed)}</span></span>
                    </div>
                  </div>
                  <button className="song-delete" onClick={(e) => deleteSong(song.id, e)}>✕</button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ===== PRACTICE ===== */}
        <main className="practice">
          <div className="practice-header">
            {/* Library toggle */}
            <button
              className="lib-toggle"
              onClick={() => setLibraryOpen((o) => !o)}
              title={libraryOpen ? "Collapse library" : "Expand library"}
            >
              {libraryOpen ? "◀" : "▶"}
            </button>

            <div className={`song-title-display${activeSong ? "" : " placeholder"}`}>
              {activeSong ? activeSong.name : "No song loaded"}
            </div>

            <div className="controls">
              <div className="bpm-control">
                <span>BPM</span>
                <input type="number" className="bpm-input" value={bpm} min={20} max={300}
                  onChange={(e) => { setBpm(Number(e.target.value)); if (mode === "auto") stopAll(); }} />
              </div>
              <button className="ctrl-btn" onClick={stepBack}    disabled={beatIndex === 0 || mode !== "free"}>◀</button>
              <button className="ctrl-btn" onClick={stepForward} disabled={beatIndex >= beats.length || mode !== "free"}>▶</button>
              <button className="ctrl-btn" onClick={restart}     disabled={beats.length === 0}>↺</button>
              {mode === "auto"
                ? <button className="ctrl-btn danger" onClick={stopAll}>■ Stop</button>
                : <button className="ctrl-btn active" onClick={startAutoPlay} disabled={beats.length === 0}>▶ Auto</button>
              }
              {mode === "practice"
                ? <button className="ctrl-btn danger" onClick={stopAll}>■ Stop</button>
                : <button className={`ctrl-btn${mode === "free" ? " practice-btn" : ""}`} onClick={startPractice} disabled={beats.length === 0}>🎯 Practice</button>
              }
            </div>
          </div>

          {/* Progress bar */}
          {beats.length > 0 && (
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${progress * 100}%` }} />
              <span className="progress-label">{beatIndex} / {beats.length}</span>
            </div>
          )}

          {/* Score preview */}
          {beats.length > 0 && (
            <div className="score-preview" ref={scoreRef}>
              {beats.map((beat, i) => {
                const isPast = i < beatIndex, isCurrent = i === beatIndex, isRest = beat[0] === "-";
                return (
                  <span key={i}
                    className={["beat-token", isPast ? "past" : "", isCurrent ? "current" : "", isRest ? "rest" : ""].filter(Boolean).join(" ")}
                    style={{ minWidth: beat.length > 1 ? `${beat.length * 14 + 8}px` : undefined }}
                    onClick={() => { if (mode === "free") { setBeatIndex(i); beatIndexRef.current = i; } }}
                  >
                    {isRest ? "—" : beat.join("")}
                  </span>
                );
              })}
            </div>
          )}

          {/* Main display */}
          <div className="practice-main">
            {beats.length === 0 ? (
              <div className="no-song-placeholder">
                <div className="icon">🎹</div>
                <p>Load a song from the library<br />or upload a new score.</p>
              </div>
            ) : isComplete ? (
              <div className="no-song-placeholder">
                <div className="icon">🎉</div>
                <p>Song complete!<br />
                  {sessionAcc !== null && <span style={{ color: "var(--accent)" }}>Accuracy: {sessionAcc}%</span>}
                </p>
                <button className="ctrl-btn active" style={{ marginTop: 8 }} onClick={restart}>Play Again ↺</button>
              </div>
            ) : (
              <div className="note-display">
                {mode !== "free" && (
                  <div className={`mode-badge mode-${mode}`}>
                    {mode === "auto" ? "▶ Auto Play" : "🎯 Practice Mode"}
                  </div>
                )}

                {currentBeat[0] === "-"
                  ? <div className="note-key-badge rest-badge">—</div>
                  : <NoteKeyBadge keys={currentBeat} size="big" />
                }

                {mode === "practice" && currentBeat[0] !== "-" && currentBeat.length > 1 && (
                  <div className="chord-progress">
                    {currentBeat.map((k) => (
                      <div key={k} className={`chord-key-indicator ${pendingKeys.has(k) ? "pending" : "done"}`}>{k}</div>
                    ))}
                  </div>
                )}

                <div className="next-note-area">
                  <span className="next-label">NEXT</span>
                  {nextBeat.length > 0
                    ? <NoteKeyBadge keys={nextBeat} size="small" />
                    : <span style={{ fontSize: 11, color: "var(--text-dim)" }}>—</span>
                  }
                </div>

                <div className="stats-row">
                  <div className="stat-chip"><div className="val">{beatIndex}</div><div className="lbl">Beat</div></div>
                  <div className="stat-divider" />
                  <div className="stat-chip"><div className="val">{beats.length}</div><div className="lbl">Total</div></div>
                  {sessionAcc !== null && (
                    <>
                      <div className="stat-divider" />
                      <div className="stat-chip">
                        <div className={`val ${sessionAcc >= 80 ? "accuracy-good" : sessionAcc >= 50 ? "accuracy-mid" : "accuracy-bad"}`}>
                          {sessionAcc}%
                        </div>
                        <div className="lbl">Accuracy</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>{/* end app-top */}

      {/* ===== KEYBOARD — always bottom row ===== */}
      <div className="keyboard-area">
        {([
          { keys: HIGH_KEYS, octave: "high" as const },
          { keys: MID_KEYS,  octave: "mid"  as const },
          { keys: LOW_KEYS,  octave: "low"  as const },
        ]).map(({ keys, octave }) => (
          <div key={octave} className="octave-row">
            {keys.map((k) => (
              <PianoKey key={k} label={k} octave={octave}
                highlighted={highlightedKeys.has(k)}
                pressed={pressedKeys.has(k)}
                flashCorrect={flashKeys.get(k) === "correct"}
                flashWrong={flashKeys.get(k) === "wrong"}
                onPress={(key) => {
                  handlePianoKey(key);
                  setPressedKeys((prev) => {
                    const n = new Set([...prev, key]);
                    setTimeout(() => setPressedKeys((p) => { const x = new Set(p); x.delete(key); return x; }), 150);
                    return n;
                  });
                }}
              />
            ))}
          </div>
        ))}
      </div>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onSave={(name, content) => setSongs((prev) => [...prev, makeSong(name, content)])} />}
    </div>
  );
}
