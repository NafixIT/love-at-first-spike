
import { useEffect, useState } from "react";
import "./WelcomeScreen.css";

const videos = [
  "/videos/50a361d3e2.mp4",
  "/videos/50a361d3e2%20copy.mp4",
  "/videos/921-141890445_medium.mp4",
  "/videos/921-141890445_medium%20copy.mp4",
];

export default function WelcomeScreen({ onBegin }) {
  const [activeVideo, setActiveVideo] = useState(0);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveVideo((current) => (current + 1) % videos.length);
      setVideoFailed(false);
    }, 9000);

    return () => clearInterval(timer);
  }, []);

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  return (
    <main className="welcome-page">
      <div className="welcome-background">
        {!videoFailed && (
          <video
            key={videos[activeVideo]}
            className="welcome-video"
            src={videos[activeVideo]}
            autoPlay
            muted
            playsInline
            onError={() => setVideoFailed(true)}
          />
        )}
        <div className="welcome-shade" />
      </div>

      <aside className="welcome-sidebar">
        <div className="welcome-brand">
          <span className="brand-ball">🏐</span>
          <span>
            LOVE AT
            <br />
            FIRST SPIKE
          </span>
        </div>

        <nav className="welcome-nav" aria-label="Main navigation">
          <button
            className="nav-button selected"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            <span>⌂</span> Home
          </button>

          <button
            className="nav-button"
            onClick={() => scrollTo("welcome-about")}
          >
            <span>✦</span> About
          </button>

          <button
            className="nav-button"
            onClick={() => scrollTo("welcome-features")}
          >
            <span>🏐</span> Features
          </button>

          <button className="nav-button nav-start" onClick={onBegin}>
            <span>▶</span> Let's Begin
          </button>
        </nav>

        <div className="welcome-sidebar-footer">
          <span>SET · SPIKE · SCORE</span>
          <span>YOUR COURT. YOUR GAME.</span>
        </div>
      </aside>

      <section className="welcome-content">
        <div className="welcome-eyebrow">
          <span className="eyebrow-line" />
          YOUR VOLLEYBALL MATCH COMPANION
        </div>

        <h1 className="welcome-title">
          LOVE AT
          <br />
          FIRST <span>SPIKE.</span>
        </h1>

        <p className="welcome-subtitle">
          Every rally tells a story.
          <br />
          Every point brings you closer to victory.
        </p>

        <button className="begin-bubble" onClick={onBegin}>
          <span className="begin-icon">▶</span>
          <span>
            <strong>LET'S BEGIN</strong>
            <small>YOUR MATCH STARTS HERE</small>
          </span>
          <span className="begin-arrow">↗</span>
        </button>

        <div className="welcome-video-indicator">
          {videos.map((video, index) => (
            <button
              key={video}
              className={`video-dot ${index === activeVideo ? "active" : ""}`}
              aria-label={`Show background video ${index + 1}`}
              onClick={() => {
                setActiveVideo(index);
                setVideoFailed(false);
              }}
            />
          ))}
          <span>SCENE 0{activeVideo + 1} / 04</span>
        </div>

        <div className="welcome-info" id="welcome-about">
          <span className="info-number">01</span>
          <div>
            <h2>MORE THAN A SCOREBOARD</h2>
            <p>
              Set up your teams, manage your lineups, track every point,
              and keep your match moving with one volleyball-focused toolkit.
            </p>
          </div>
        </div>

        <div className="welcome-info" id="welcome-features">
          <span className="info-number">02</span>
          <div>
            <h2>READY FOR THE NEXT RALLY?</h2>
            <p>
              Custom match rules, player rotations, substitutions, libero
              tracking, timeouts, set history, and undo are waiting for you.
            </p>
          </div>
        </div>
      </section>

      <div className="welcome-corner-label">
        GAME ON <span>✦</span>
      </div>
    </main>
  );
}
