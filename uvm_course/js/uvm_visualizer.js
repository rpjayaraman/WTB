/**
 * UVM Visualizer & Topology Engine
 * Renders interactive SVG UVM component hierarchy trees and phase timelines.
 */

window.UVMVisualizer = {
  renderTopology: function(containerId, chapterId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // SVG Topology based on standard UVM testbench structure
    const svg = `
    <svg viewBox="0 0 760 320" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="max-height: 280px;">
      <defs>
        <linearGradient id="grad-test" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#1d4ed8" stop-opacity="0.6"/>
        </linearGradient>
        <linearGradient id="grad-env" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#6d28d9" stop-opacity="0.6"/>
        </linearGradient>
        <linearGradient id="grad-agent" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#0891b2" stop-opacity="0.6"/>
        </linearGradient>
        <linearGradient id="grad-comp" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#10b981" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="#047857" stop-opacity="0.5"/>
        </linearGradient>
        <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#00f0ff"/>
        </marker>
      </defs>

      <!-- uvm_top / uvm_root -->
      <rect x="20" y="20" width="720" height="280" rx="10" fill="none" stroke="rgba(255,255,255,0.15)" stroke-dasharray="4"/>
      <text x="35" y="42" fill="#64748b" font-family="monospace" font-size="11" font-weight="bold">uvm_top (uvm_root singleton)</text>

      <!-- uvm_test_top -->
      <rect x="40" y="55" width="680" height="230" rx="8" fill="url(#grad-test)" stroke="#3b82f6" stroke-width="1.5"/>
      <text x="55" y="75" fill="#93c5fd" font-family="monospace" font-size="12" font-weight="bold">uvm_test_top (uvm_test)</text>

      <!-- uvm_env -->
      <rect x="60" y="90" width="460" height="180" rx="6" fill="url(#grad-env)" stroke="#8b5cf6" stroke-width="1.5"/>
      <text x="75" y="110" fill="#c4b5fd" font-family="monospace" font-size="11" font-weight="bold">env (uvm_env)</text>

      <!-- Scoreboard -->
      <rect x="540" y="90" width="160" height="180" rx="6" fill="url(#grad-comp)" stroke="#10b981" stroke-width="1.5"/>
      <text x="555" y="115" fill="#6ee7b7" font-family="monospace" font-size="11" font-weight="bold">scoreboard</text>
      <text x="555" y="145" fill="#a7f3d0" font-family="monospace" font-size="9">Analysis Imp: exp_in</text>
      <text x="555" y="165" fill="#a7f3d0" font-family="monospace" font-size="9">Analysis Imp: act_in</text>
      <text x="555" y="195" fill="#6ee7b7" font-family="monospace" font-size="9">check_phase()</text>
      <text x="555" y="215" fill="#6ee7b7" font-family="monospace" font-size="9">report_phase()</text>

      <!-- Agent -->
      <rect x="80" y="125" width="420" height="130" rx="6" fill="url(#grad-agent)" stroke="#06b6d4" stroke-width="1.5"/>
      <text x="95" y="145" fill="#a5f3fc" font-family="monospace" font-size="11" font-weight="bold">agent (uvm_agent - ACTIVE)</text>

      <!-- Sequencer -->
      <rect x="95" y="160" width="115" height="80" rx="4" fill="#0f172a" stroke="#38bdf8" stroke-width="1"/>
      <text x="105" y="180" fill="#38bdf8" font-family="monospace" font-size="10" font-weight="bold">sequencer</text>
      <text x="105" y="200" fill="#94a3b8" font-family="monospace" font-size="8">seq_item_export</text>
      <text x="105" y="218" fill="#94a3b8" font-family="monospace" font-size="8">Arbitration: FIFO</text>

      <!-- Driver -->
      <rect x="235" y="160" width="115" height="80" rx="4" fill="#0f172a" stroke="#ec4899" stroke-width="1"/>
      <text x="245" y="180" fill="#f472b6" font-family="monospace" font-size="10" font-weight="bold">driver</text>
      <text x="245" y="200" fill="#94a3b8" font-family="monospace" font-size="8">seq_item_port</text>
      <text x="245" y="218" fill="#94a3b8" font-family="monospace" font-size="8">vif.pin_drive()</text>

      <!-- Monitor -->
      <rect x="375" y="160" width="115" height="80" rx="4" fill="#0f172a" stroke="#10b981" stroke-width="1"/>
      <text x="385" y="180" fill="#34d399" font-family="monospace" font-size="10" font-weight="bold">monitor</text>
      <text x="385" y="200" fill="#94a3b8" font-family="monospace" font-size="8">analysis_port</text>
      <text x="385" y="218" fill="#94a3b8" font-family="monospace" font-size="8">vif.pin_sample()</text>

      <!-- Handshake TLM Arrow -->
      <path d="M 210 200 L 235 200" stroke="#00f0ff" stroke-width="2" marker-end="url(#arrow)"/>
      <text x="202" y="193" fill="#00f0ff" font-family="monospace" font-size="8">TLM</text>

      <!-- Analysis Broadcast to Scoreboard -->
      <path d="M 490 200 Q 515 200 540 180" fill="none" stroke="#34d399" stroke-width="1.5" stroke-dasharray="3" marker-end="url(#arrow)"/>
    </svg>
    `;
    container.innerHTML = svg;
  },

  renderPhaseTimeline: function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const phases = [
      { name: "build", type: "function", order: "top-down", desc: "Instantiate components & config" },
      { name: "connect", type: "function", order: "bottom-up", desc: "Bind TLM ports & exports" },
      { name: "end_of_elaboration", type: "function", order: "bottom-up", desc: "Finalize topology" },
      { name: "start_of_simulation", type: "function", order: "bottom-up", desc: "Pre-run banners" },
      { name: "run", type: "task", order: "parallel", desc: "Consumes simulation time (#delay)" },
      { name: "extract", type: "function", order: "bottom-up", desc: "Retrieve coverage & score data" },
      { name: "check", type: "function", order: "bottom-up", desc: "Check queues empty & errors == 0" },
      { name: "report", type: "function", order: "bottom-up", desc: "Print summary reports" },
      { name: "final", type: "function", order: "top-down", desc: "Post-simulation cleanup" }
    ];

    let html = `
    <div style="display: flex; gap: 6px; overflow-x: auto; padding: 10px 4px;">
    `;

    phases.forEach((p, idx) => {
      const isTask = p.type === "task";
      const badgeColor = isTask ? "#ec4899" : "#38bdf8";
      html += `
        <div style="flex: 1; min-width: 95px; background: rgba(255,255,255,0.03); border: 1px solid ${isTask ? 'rgba(236,72,153,0.4)' : 'rgba(255,255,255,0.08)'}; border-radius: 6px; padding: 6px 8px; font-family: var(--font-mono); font-size: 0.72rem;">
          <div style="color: ${badgeColor}; font-weight: bold; margin-bottom: 2px;">${idx + 1}. ${p.name}</div>
          <div style="font-size: 0.62rem; color: #64748b; margin-bottom: 4px;">[${p.type}]</div>
          <div style="font-size: 0.64rem; color: #94a3b8; line-height: 1.2;">${p.order}</div>
        </div>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;
  }
};
