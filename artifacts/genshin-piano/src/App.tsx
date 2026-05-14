import { useState, useEffect, useRef, useCallback } from "react";
import "./index.css";

// ===== TYPES =====
type Beat = string[]; // e.g. ['A'], ['A','Q'] chord, ['-'] rest
type Song = {
  id: string;
  name: string;
  content: string;
  playCount: number;
  lastPlayed: string | null;
  totalHits: number;
  totalAttempts: number;
};

// ===== CONSTANTS =====
const HIGH_KEYS = ["Q", "W", "E", "R", "T", "Y", "U"];
const MID_KEYS = ["A", "S", "D", "F", "G", "H", "J"];
const LOW_KEYS = ["Z", "X", "C", "V", "B", "N", "M"];
const ALL_KEYS = new Set([...HIGH_KEYS, ...MID_KEYS, ...LOW_KEYS]);

const KEY_FREQ: Record<string, number> = {
  Q: 1046.5, W: 1174.66, E: 1318.51, R: 1396.91, T: 1567.98, Y: 1760.0, U: 1975.53,
  A: 523.25,  S: 587.33,  D: 659.25,  F: 698.46,  G: 783.99,  H: 880.0,  J: 987.77,
  Z: 261.63,  X: 293.66,  C: 329.63,  V: 349.23,  B: 392.0,   N: 440.0,  M: 493.88,
};

const KEY_OCTAVE: Record<string, "high" | "mid" | "low"> = {
  ...Object.fromEntries(HIGH_KEYS.map((k) => [k, "high" as const])),
  ...Object.fromEntries(MID_KEYS.map((k) => [k, "mid" as const])),
  ...Object.fromEntries(LOW_KEYS.map((k) => [k, "low" as const])),
};

const NOTE_NAMES: Record<string, string> = {
  Q: "C6", W: "D6", E: "E6", R: "F6", T: "G6", Y: "A6", U: "B6",
  A: "C5", S: "D5", D: "E5", F: "F5", G: "G5", H: "A5", J: "B5",
  Z: "C4", X: "D4", C: "E4", V: "F4", B: "G4", N: "A4", M: "B4",
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
  const octave = KEY_OCTAVE[key];
  osc.type = octave === "high" ? "sine" : octave === "mid" ? "triangle" : "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.45, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.9);
}

function playBeat(beat: Beat) {
  beat.forEach((k) => playKey(k));
}

// ===== SCORE PARSER =====
function parseScore(content: string): Beat[] {
  const tokens = content.trim().split(/\s+/).filter(Boolean);
  return tokens.map((token) => {
    if (token === "-") return ["-"];
    const keys = token.toUpperCase().split("").filter((k) => ALL_KEYS.has(k));
    return keys.length > 0 ? keys : null;
  }).filter((b): b is Beat => b !== null);
}

// ===== LOCALSTORAGE =====
const LS_KEY = "genshin_piano_songs";

function loadSongs(): Song[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSongs(songs: Song[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(songs));
}

function makeSong(name: string, content: string): Song {
  return {
    id: crypto.randomUUID(),
    name,
    content,
    playCount: 0,
    lastPlayed: null,
    totalHits: 0,
    totalAttempts: 0,
  };
}

function accuracy(song: Song): number | null {
  if (song.totalAttempts === 0) return null;
  return Math.round((song.totalHits / song.totalAttempts) * 100);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ===== SUBCOMPONENTS =====

function PianoKey({
  label,
  octave,
  highlighted,
  pressed,
  flashCorrect,
  flashWrong,
  onPress,
}: {
  label: string;
  octave: "high" | "mid" | "low";
  highlighted: boolean;
  pressed: boolean;
  flashCorrect: boolean;
  flashWrong: boolean;
  onPress: (key: string) => void;
}) {
  const cls = [
    "piano-key",
    `octave-${octave}`,
    highlighted ? "highlighted" : "",
    pressed ? "pressed" : "",
    flashCorrect ? "correct-flash" : "",
    flashWrong ? "wrong-flash" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={cls}
      onPointerDown={(e) => { e.preventDefault(); onPress(label); }}
    >
      {label}
      <span className="piano-key-label">{NOTE_NAMES[label]}</span>
    </div>
  );
}

function NoteKeyBadge({ keys, size }: { keys: string[]; size: "big" | "small" }) {
  if (keys[0] === "-") {
    if (size === "big") {
      return <div className="note-key-badge rest-badge">— </div>;
    }
    return (
      <div className="next-key-small" style={{ color: "var(--rest-color)", fontSize: 14 }}>—</div>
    );
  }

  if (size === "big") {
    return (
      <div className="current-note">
        {keys.map((k) => (
          <div key={k} className={`note-key-badge octave-${KEY_OCTAVE[k]}`}>
            {k}
            <span className="note-label">{NOTE_NAMES[k]}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="next-note-badge">
      {keys.map((k) => (
        <div key={k} className="next-key-small">{k}</div>
      ))}
    </div>
  );
}

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
        <input
          type="text"
          placeholder="Song name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <div style={{ marginBottom: 10 }}>
          <button
            className="ctrl-btn"
            style={{ width: "100%", justifyContent: "center", marginBottom: 8 }}
            onClick={() => fileRef.current?.click()}
          >
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
          <button className="ctrl-btn active" onClick={handleSave} disabled={!name.trim() || !content.trim()}>
            Save Song
          </button>
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(80);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  const [highlightedKeys, setHighlightedKeys] = useState<Set<string>>(new Set());
  const [flashKeys, setFlashKeys] = useState<Map<string, "correct" | "wrong">>(new Map());
  const [showUpload, setShowUpload] = useState(false);
  const [sessionHits, setSessionHits] = useState(0);
  const [sessionAttempts, setSessionAttempts] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const beatIndexRef = useRef(0);
  const scoreRef = useRef<HTMLDivElement>(null);

  // Persist songs
  useEffect(() => { saveSongs(songs); }, [songs]);

  // Sync beatIndexRef
  useEffect(() => { beatIndexRef.current = beatIndex; }, [beatIndex]);

  // Scroll score preview to current beat
  useEffect(() => {
    if (!scoreRef.current) return;
    const current = scoreRef.current.querySelector(".beat-token.current") as HTMLElement | null;
    if (current) current.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [beatIndex]);

  // Update highlighted keys when beat changes
  useEffect(() => {
    if (beats.length === 0) { setHighlightedKeys(new Set()); return; }
    const beat = beats[beatIndex] ?? [];
    setHighlightedKeys(new Set(beat.filter((k) => k !== "-")));
  }, [beats, beatIndex]);

  // Keyboard handler
  useEffect(() => {
    const down = new Set<string>();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toUpperCase();
      if (!ALL_KEYS.has(key)) return;
      e.preventDefault();
      down.add(key);
      setPressedKeys((prev) => new Set([...prev, key]));
      handleKeyPress(key);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      down.delete(key);
      setPressedKeys((prev) => { const n = new Set(prev); n.delete(key); return n; });
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beats, beatIndex, isPlaying]);

  const handleKeyPress = useCallback((key: string) => {
    playKey(key);
    flashKey(key, "correct");

    // In playing mode, check if key matches current beat
    if (beats.length > 0 && !isPlaying) {
      const idx = beatIndexRef.current;
      const currentBeat = beats[idx] ?? [];
      if (currentBeat[0] === "-") return; // rest — ignore key
      const isCorrect = currentBeat.includes(key);
      if (isCorrect) {
        flashKey(key, "correct");
      } else {
        flashKey(key, "wrong");
        setSessionAttempts((a) => a + 1);
      }
    }
  }, [beats, isPlaying]);

  function flashKey(key: string, type: "correct" | "wrong") {
    setFlashKeys((prev) => new Map([...prev, [key, type]]));
    setTimeout(() => {
      setFlashKeys((prev) => { const n = new Map(prev); n.delete(key); return n; });
    }, 180);
  }

  function loadSong(song: Song) {
    stop();
    const parsed = parseScore(song.content);
    setBeats(parsed);
    setBeatIndex(0);
    setActiveSongId(song.id);
    setSessionHits(0);
    setSessionAttempts(0);
    // Update stats
    setSongs((prev) => prev.map((s) =>
      s.id === song.id
        ? { ...s, playCount: s.playCount + 1, lastPlayed: new Date().toISOString() }
        : s
    ));
  }

  function start() {
    if (beats.length === 0) return;
    setIsPlaying(true);
    getAudioCtx(); // unlock audio on first interaction
    const ms = Math.round(60000 / bpm);

    intervalRef.current = setInterval(() => {
      const idx = beatIndexRef.current;
      if (idx >= beats.length) {
        stop();
        return;
      }
      const beat = beats[idx];
      playBeat(beat);
      setBeatIndex(idx + 1);
      beatIndexRef.current = idx + 1;
    }, ms);
  }

  function stop() {
    setIsPlaying(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function restart() {
    stop();
    setBeatIndex(0);
    beatIndexRef.current = 0;
    setSessionHits(0);
    setSessionAttempts(0);
  }

  function stepForward() {
    if (beats.length === 0) return;
    const next = Math.min(beatIndex + 1, beats.length);
    const beat = beats[beatIndex];
    if (beat) playBeat(beat);
    setBeatIndex(next);
  }

  function stepBack() {
    const prev = Math.max(beatIndex - 1, 0);
    setBeatIndex(prev);
  }

  function deleteSong(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSongs((prev) => prev.filter((s) => s.id !== id));
    if (activeSongId === id) {
      setActiveSongId(null);
      setBeats([]);
      setBeatIndex(0);
      stop();
    }
  }

  function saveSong(name: string, content: string) {
    const song = makeSong(name, content);
    setSongs((prev) => [...prev, song]);
  }

  const activeSong = songs.find((s) => s.id === activeSongId) ?? null;
  const currentBeat: Beat = beats[beatIndex] ?? [];
  const nextBeat: Beat = beats[beatIndex + 1] ?? [];
  const acc = sessionAttempts > 0 ? Math.round((sessionHits / sessionAttempts) * 100) : null;

  return (
    <div className="app">
      {/* ===== LIBRARY ===== */}
      <aside className="library">
        <div className="library-header">
          <h2>Songs</h2>
          <button className="upload-btn" onClick={() => setShowUpload(true)}>
            + Upload
          </button>
        </div>
        <div className="song-list">
          {songs.length === 0 && (
            <div className="library-empty">
              <p>🎵</p>
              <p>No songs yet.<br />Upload a .txt score to start.</p>
            </div>
          )}
          {songs.map((song) => {
            const acc = accuracy(song);
            return (
              <div
                key={song.id}
                className={`song-item${activeSongId === song.id ? " active" : ""}`}
                onClick={() => loadSong(song)}
              >
                <div className="song-item-body">
                  <div className="song-name">{song.name}</div>
                  <div className="song-meta">
                    <span className="song-stat">▶ <span>{song.playCount}</span></span>
                    {acc !== null && (
                      <span className="song-stat">🎯 <span>{acc}%</span></span>
                    )}
                    <span className="song-stat">🕐 <span>{fmtDate(song.lastPlayed)}</span></span>
                  </div>
                </div>
                <button className="song-delete" onClick={(e) => deleteSong(song.id, e)}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ===== PRACTICE PANEL ===== */}
      <main className="practice">
        <div className="practice-header">
          <div className={`song-title-display${activeSong ? "" : " placeholder"}`}>
            {activeSong ? activeSong.name : "No song loaded"}
          </div>

          <div className="controls">
            <div className="bpm-control">
              <span>BPM</span>
              <input
                type="number"
                className="bpm-input"
                value={bpm}
                min={20}
                max={300}
                onChange={(e) => { setBpm(Number(e.target.value)); if (isPlaying) { stop(); } }}
              />
            </div>
            <button className="ctrl-btn" onClick={stepBack} disabled={beatIndex === 0}>◀</button>
            <button className="ctrl-btn" onClick={stepForward} disabled={beatIndex >= beats.length}>▶</button>
            <button className="ctrl-btn" onClick={restart} disabled={beats.length === 0}>↺</button>
            {isPlaying
              ? <button className="ctrl-btn danger" onClick={stop}>■ Stop</button>
              : <button className="ctrl-btn active" onClick={start} disabled={beats.length === 0}>▶ Play</button>
            }
          </div>
        </div>

        {/* Score preview */}
        {beats.length > 0 && (
          <div className="score-preview" ref={scoreRef}>
            {beats.map((beat, i) => {
              const isPast = i < beatIndex;
              const isCurrent = i === beatIndex;
              const isRest = beat[0] === "-";
              return (
                <span
                  key={i}
                  className={[
                    "beat-token",
                    isPast ? "past" : "",
                    isCurrent ? "current" : "",
                    isRest ? "rest" : "",
                  ].filter(Boolean).join(" ")}
                  style={{ minWidth: beat.length > 1 ? `${beat.length * 14 + 8}px` : undefined }}
                  onClick={() => { stop(); setBeatIndex(i); }}
                >
                  {beat[0] === "-" ? "—" : beat.join("")}
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
          ) : (
            <div className="note-display">
              {/* Current beat */}
              {currentBeat.length > 0
                ? <NoteKeyBadge keys={currentBeat} size="big" />
                : <div className="note-key-badge rest-badge" style={{ fontSize: 20, color: "var(--success)" }}>✓ Done</div>
              }

              {/* Next beat */}
              <div className="next-note-area">
                <span className="next-label">NEXT</span>
                {nextBeat.length > 0
                  ? <NoteKeyBadge keys={nextBeat} size="small" />
                  : <span style={{ fontSize: 11, color: "var(--text-dim)" }}>—</span>
                }
              </div>

              {/* Stats */}
              <div className="stats-row">
                <div className="stat-chip">
                  <div className="val">{beatIndex}</div>
                  <div className="lbl">Beat</div>
                </div>
                <div className="stat-divider" />
                <div className="stat-chip">
                  <div className="val">{beats.length}</div>
                  <div className="lbl">Total</div>
                </div>
                {acc !== null && (
                  <>
                    <div className="stat-divider" />
                    <div className="stat-chip">
                      <div className={`val ${acc >= 80 ? "accuracy-good" : acc >= 50 ? "accuracy-mid" : "accuracy-bad"}`}>
                        {acc}%
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

      {/* ===== KEYBOARD ===== */}
      <div className="keyboard-area">
        {[
          { keys: HIGH_KEYS, octave: "high" as const },
          { keys: MID_KEYS, octave: "mid" as const },
          { keys: LOW_KEYS, octave: "low" as const },
        ].map(({ keys, octave }) => (
          <div key={octave} className="octave-row">
            {keys.map((k) => (
              <PianoKey
                key={k}
                label={k}
                octave={octave}
                highlighted={highlightedKeys.has(k)}
                pressed={pressedKeys.has(k)}
                flashCorrect={flashKeys.get(k) === "correct"}
                flashWrong={flashKeys.get(k) === "wrong"}
                onPress={(key) => {
                  playKey(key);
                  flashKey(key, "correct");
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

      {/* ===== UPLOAD MODAL ===== */}
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSave={saveSong}
        />
      )}
    </div>
  );
}
