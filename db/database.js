<style>
.agent-tools-hub{
  --primary:#452068;
  --primary-dark:#2f1348;
  --accent:#ff1090;
  --bg:#f7f5fb;
  --card:#ffffff;
  --text:#1f1b2a;
  --muted:#6e687c;
  --border:#ece8f3;
  --radius:18px;
  --shadow:0 14px 30px rgba(20,10,40,.12);
  --shadow-soft:0 8px 18px rgba(20,10,40,.08);
  font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
  color:var(--text);
}

.agent-tools-hub *{box-sizing:border-box}

.agent-tools-hub .wrap{
  max-width:1100px;
  margin:0 auto;
  padding:22px;
}

/* HERO */
.agent-tools-hub .hero{
  background:linear-gradient(135deg,var(--primary),var(--primary-dark));
  color:#fff;
  padding:30px;
  border-radius:22px;
  box-shadow:var(--shadow);
}
.agent-tools-hub .hero h1{margin:0 0 8px;font-size:28px;}
.agent-tools-hub .hero p{margin:0;font-size:14px;opacity:.92;max-width:95ch;line-height:1.55}

/* SECTION */
.agent-tools-hub .section{margin-top:24px;}
.agent-tools-hub .section-head{margin:16px 0 10px;}
.agent-tools-hub .section-head h2{margin:0 0 6px;font-size:20px;}
.agent-tools-hub .section-head p{margin:0;color:var(--muted);font-size:14px;line-height:1.45;max-width:72ch}

/* GRID */
.agent-tools-hub .grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:14px;
  margin-top:14px;
}

/* CARD */
.agent-tools-hub .card{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:var(--radius);
  box-shadow:var(--shadow-soft);
  padding:16px;
  display:flex;
  flex-direction:column;
  min-height:160px;
  transition:.15s ease;
}
.agent-tools-hub .card:hover{
  transform:translateY(-2px);
  box-shadow:var(--shadow);
  border-color:rgba(69,32,104,.22);
}

.agent-tools-hub .row-top{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:10px;
}

.agent-tools-hub .title{margin:0;font-size:17px;}
.agent-tools-hub .tag{
  font-size:12px;
  font-weight:800;
  padding:5px 8px;
  border-radius:999px;
  background:rgba(69,32,104,.10);
  color:var(--primary);
  white-space:nowrap;
}

.agent-tools-hub .desc{
  font-size:14px;
  color:var(--muted);
  margin:10px 0 16px;
  line-height:1.55;
  flex:1;
}

/* BUTTONS */
.agent-tools-hub .actions{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-top:auto;
}

.agent-tools-hub .btn{
  padding:9px 12px;
  border-radius:12px;
  font-weight:900;
  text-decoration:none;
  font-size:13px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border:1px solid transparent;
}

.agent-tools-hub .btn.primary{background:var(--primary);color:#fff;}
.agent-tools-hub .btn.accent{background:var(--accent);color:#fff;}
.agent-tools-hub .btn.outline{
  background:#fff;
  border-color:rgba(69,32,104,.35);
  color:var(--primary);
}
.agent-tools-hub .btn.outline:hover{
  background:rgba(69,32,104,.06);
  border-color:rgba(69,32,104,.55);
}

/* ACCORDION */
.agent-tools-hub .cert-accordion{
  margin-top:14px;
  background:#fff;
  border:1px solid var(--border);
  border-radius:18px;
  box-shadow:var(--shadow-soft);
  overflow:hidden;
}
.agent-tools-hub .cert-toggle{
  width:100%;
  border:none;
  background:#fff;
  padding:14px 16px;
  font-size:15px;
  font-weight:900;
  display:flex;
  justify-content:space-between;
  align-items:center;
  cursor:pointer;
}
.agent-tools-hub .cert-toggle small{
  font-size:13px;
  color:var(--muted);
  font-weight:700;
}
.agent-tools-hub .cert-panel{
  padding:16px;
  display:block;
}
.agent-tools-hub .cert-panel.closed{
  display:none;
}

/* DIVIDER */
.agent-tools-hub .divider{
  margin:22px 0 0;
  height:1px;
  background:linear-gradient(90deg, transparent, rgba(69,32,104,.25), transparent);
  border:none;
}

@media(max-width:900px){
  .agent-tools-hub .grid{grid-template-columns:1fr;}
}
</style>

<div class="agent-tools-hub">
  <div class="wrap">

    <!-- HERO -->
    <section class="hero">
      <h1>Agent Tools Hub</h1>
      <p>Your central access point for contracting guides, platforms, certifications, and resources.</p>
    </section>

    <!-- CONTRACTING -->
    <section class="section" id="contracting">
      <div class="section-head">
        <h2>Contracting</h2>
        <p>Start here to avoid delays and follow the correct onboarding flow.</p>
      </div>

      <div class="grid">
        <article class="card">
          <div class="row-top">
            <h3 class="title">Contracting Guide</h3>
            <span class="tag">Step-by-step</span>
          </div>
          <p class="desc">Walkthrough for onboarding and appointment requests.</p>
          <div class="actions">
            <a class="btn primary"
               href="https://docs.google.com/presentation/d/1KIAU8uobrnghsPI5TbblgPWcGLaz0bRTeXMzMQIfOss/edit?usp=sharing"
               target="_blank" rel="noopener">Open Guide</a>
          </div>
        </article>

        <article class="card">
          <div class="row-top">
            <h3 class="title">New Agent / Transfer</h3>
            <span class="tag">Quick Links</span>
          </div>
          <p class="desc">Choose your correct path to begin onboarding.</p>
          <div class="actions">
            <!-- BOTH BUTTONS SAME LINK (as requested) -->
            <a class="btn outline"
               href="https://www.agentmedicarehub.com/getting-started"
               target="_blank" rel="noopener">New Agent</a>

            <a class="btn outline"
               href="https://www.agentmedicarehub.com/getting-started"
               target="_blank" rel="noopener">Transfer Agent</a>
          </div>
        </article>
      </div>

      <hr class="divider" />
    </section>

    <!-- PLATFORMS & TOOLS -->
    <section class="section" id="platforms">
      <div class="section-head">
        <h2>Platforms &amp; Tools</h2>
        <p>Use these portals to request contracts, upload documents, manage clients, and quote/enroll.</p>
      </div>

      <div class="grid">

        <article class="card">
          <div class="row-top">
            <h3 class="title">AgentSync Guide</h3>
            <span class="tag">Contracting</span>
          </div>
          <p class="desc">Request contracts, upload required documents, and track appointment status.</p>
          <div class="actions">
            <a class="btn primary"
               href="https://www.agentmedicarehub.com/agentsync-guide"
               target="_blank" rel="noopener">Open AgentSync Guide</a>
          </div>
        </article>

        <article class="card">
          <div class="row-top">
            <h3 class="title">Nextere Guide</h3>
            <span class="tag">Contracting</span>
          </div>
          <p class="desc">Used for certain carriers and contracting workflows. Follow the guide before submitting.</p>
          <div class="actions">
            <a class="btn primary"
               href="https://www.agentmedicarehub.com/nextere-guide"
               target="_blank" rel="noopener">Open Nextere Guide</a>
          </div>
        </article>

        <article class="card">
          <div class="row-top">
            <h3 class="title">Agent Xcelerator</h3>
            <span class="tag">Contracting</span>
          </div>
          <p class="desc">Contracting and appointment platform used for specific carriers and scenarios.</p>
          <div class="actions">
            <a class="btn primary"
               href="https://www.agentmedicarehub.com/agent-xcelerator-1"
               target="_blank" rel="noopener">Open Instructions</a>
          </div>
        </article>

        <article class="card">
          <div class="row-top">
            <h3 class="title">Sunfire</h3>
            <span class="tag">Sales Tool</span>
          </div>
          <p class="desc">Quoting, enrollments, and plan comparisons. Use the portal + FAQs if needed.</p>
          <div class="actions">
            <a class="btn primary"
               href="https://www.sunfirematrix.com/app/agent/yourmedicare"
               target="_blank" rel="noopener">Open Sunfire</a>
            <a class="btn outline"
               href="https://yourfmo.com/wp-content/uploads/2024/01/v2-YourFMO-FAQ.pdf"
               target="_blank" rel="noopener">FAQs (PDF)</a>
          </div>
        </article>

        <article class="card">
          <div class="row-top">
            <h3 class="title">XCLUSIVE CRM</h3>
            <span class="tag">Included</span>
          </div>
          <p class="desc">Agency-provided CRM at no cost. Manage clients, track commissions, and automate follow-ups.</p>
          <div class="actions">
            <a class="btn accent"
               href="https://app.xclusivecrm.ai/"
               target="_blank" rel="noopener">Login to XCLUSIVE CRM</a>
          </div>
        </article>

        <article class="card">
          <div class="row-top">
            <h3 class="title">MedicarePRO CRM</h3>
            <span class="tag">Optional</span>
          </div>
          <p class="desc">Advanced CRM for tracking clients, commissions, and automated email campaigns (paid option).</p>
          <div class="actions">
            <a class="btn primary"
               href="https://www.medicareproapp.com/user/userController/login/notlogged"
               target="_blank" rel="noopener">Login to MedicarePRO</a>
          </div>
        </article>

      </div>

      <hr class="divider" />
    </section>

    <!-- CERTIFICATIONS -->
    <section class="section" id="certs">
      <div class="section-head">
        <h2>Carrier Certifications (2026)</h2>
        <p>Click below to collapse/expand and access carrier portals.</p>
      </div>

      <div class="cert-accordion">
        <button type="button" class="cert-toggle" id="certBtn" aria-expanded="true" aria-controls="certPanel">
          <span>Certifications List</span>
          <small>Click to collapse / expand</small>
        </button>

        <div class="cert-panel" id="certPanel">
          <div class="grid">

            <article class="card">
              <div class="row-top"><h3 class="title">Aetna</h3><span class="tag">Portal</span></div>
              <p class="desc">Certification login portal.</p>
              <div class="actions">
                <a class="btn primary" href="https://aetna.cmpsystem.com/page/login" target="_blank" rel="noopener">Certification Login</a>
              </div>
            </article>

            <article class="card">
              <div class="row-top"><h3 class="title">Anthem / Elevance</h3><span class="tag">Portal + Guides</span></div>
              <p class="desc">Certification login plus FAQ and user guide.</p>
              <div class="actions">
                <a class="btn primary" href="https://getcertified.elevancehealth.com/medicare/certify?brand=ELV" target="_blank" rel="noopener">Login</a>
                <a class="btn outline" href="https://yourfmo.com/wp-content/uploads/2025/08/Elevance-Health-Easy-Guide-External.pdf" target="_blank" rel="noopener">FAQ</a>
                <a class="btn outline" href="https://yourfmo.com/wp-content/uploads/2025/08/2026_WCW_User_Guide.pdf" target="_blank" rel="noopener">Guide</a>
              </div>
            </article>

            <article class="card">
              <div class="row-top"><h3 class="title">Devoted</h3><span class="tag">Portal + Guide</span></div>
              <p class="desc">Agent portal login and onboarding guide.</p>
              <div class="actions">
                <a class="btn primary" href="https://agent.devoted.com/#/" target="_blank" rel="noopener">Login</a>
                <a class="btn outline" href="https://yourfmo.com/wp-content/uploads/2025/08/DH-Agent-Onboarding-Quick-Start-Guide.pdf" target="_blank" rel="noopener">Guide</a>
              </div>
            </article>

            <article class="card">
              <div class="row-top"><h3 class="title">Florida Blue</h3><span class="tag">Portal + Guide</span></div>
              <p class="desc">Broker portal and training job aid.</p>
              <div class="actions">
                <a class="btn primary" href="https://www.floridablue.com/agents" target="_blank" rel="noopener">Login</a>
                <a class="btn outline" href="https://yourfmo.com/wp-content/uploads/2025/08/Registering-for-2026-AHIP-FBM-Sales-Product-Training-for-Brokers-Job-Aid.pdf" target="_blank" rel="noopener">Guide</a>
              </div>
            </article>

            <article class="card">
              <div class="row-top"><h3 class="title">Freedom / Optum</h3><span class="tag">Portal + Guide</span></div>
              <p class="desc">VIP Agent Support login and certification guide.</p>
              <div class="actions">
                <a class="btn primary" href="https://vipagentsupport.com/Account/Login" target="_blank" rel="noopener">Login</a>
                <a class="btn outline" href="https://yourfmo.com/wp-content/uploads/2025/08/Elevance-Health-Easy-Guide-External.pdf" target="_blank" rel="noopener">Guide</a>
              </div>
            </article>

            <article class="card">
              <div class="row-top"><h3 class="title">HealthSpring</h3><span class="tag">Portal + Guide</span></div>
              <p class="desc">Certification portal login and roadmap to certification.</p>
              <div class="actions">
                <a class="btn primary" href="https://university.healthspringforbrokers.com/Portal/Login" target="_blank" rel="noopener">Login</a>
                <a class="btn outline" href="https://yourfmo.com/wp-content/uploads/2025/08/2026_Roadmap-to-Certification.pdf" target="_blank" rel="noopener">Guide</a>
              </div>
            </article>

            <article class="card">
              <div class="row-top"><h3 class="title">Humana / CarePlus</h3><span class="tag">Portal + Guide</span></div>
              <p class="desc">Humana login and certification/recertification instructions.</p>
              <div class="actions">
                <a class="btn primary" href="https://account.humana.com/" target="_blank" rel="noopener">Login</a>
                <a class="btn outline" href="https://yourfmo.com/wp-content/uploads/2025/08/How-to-Complete-Humana-MAPD-Certification-and-Recertification.pdf" target="_blank" rel="noopener">Guide</a>
              </div>
            </article>

            <article class="card">
              <div class="row-top"><h3 class="title">UnitedHealthcare (UHC)</h3><span class="tag">Portal + Guide</span></div>
              <p class="desc">Jarvis login and 2026 certification user guide.</p>
              <div class="actions">
                <a class="btn primary" href="https://www.uhcjarvis.com/content/jarvis/en/sign_in.html#/sign_in" target="_blank" rel="noopener">Login</a>
                <a class="btn outline" href="https://yourfmo.com/wp-content/uploads/2025/08/2026-Certification-User-Guide-06252025-v2.pdf" target="_blank" rel="noopener">Guide</a>
              </div>
            </article>

            <article class="card">
              <div class="row-top"><h3 class="title">WellCare (Centene)</h3><span class="tag">2 Steps</span></div>
              <p class="desc">Step 1: Broker resources. Step 2: Follow PingOne Workbench instructions if needed.</p>
              <div class="actions">
                <a class="btn primary" href="https://www.wellcare.com/en/broker-resources/broker-resources" target="_blank" rel="noopener">Step 1</a>
                <a class="btn outline" href="https://yourfmo.com/wp-content/uploads/2025/08/2026-CWB-Training-Center-Access-Instructions_All-Users_Final_07162025.pdf" target="_blank" rel="noopener">Cert Guide</a>
                <a class="btn outline" href="https://yourfmo.com/wp-content/uploads/2022/08/WC_Contract_Recertification_HowtoGuide.pdf" target="_blank" rel="noopener">Step 2 Guide</a>
              </div>
            </article>

          </div>
        </div>
      </div>

      <hr class="divider" />
    </section>

    <!-- RESOURCES -->
    <section class="section" id="resources">
      <div class="section-head">
        <h2>Resources</h2>
        <p>Reference materials and internal resources you’ll use regularly.</p>
      </div>

      <div class="grid">

        <article class="card">
          <div class="row-top"><h3 class="title">Carrier Vendors &amp; Contacts</h3><span class="tag">Support</span></div>
          <p class="desc">Access vendor contacts and key carrier support resources.</p>
          <div class="actions">
            <a class="btn primary" href="https://docs.google.com/presentation/d/1KIAU8uobrnghsPI5TbblgPWcGLaz0bRTeXMzMQIfOss/edit?usp=sharing" target="_blank" rel="noopener">View Carrier Vendors</a>
          </div>
        </article>

        <article class="card">
          <div class="row-top"><h3 class="title">Media &amp; Logo Approvals</h3><span class="tag">Marketing</span></div>
          <p class="desc">Carrier-approved logos, marketing materials, and submission guidelines.</p>
          <div class="actions">
            <a class="btn outline" href="https://gamma.app/docs/bbwetimi7ofdpvr" target="_blank" rel="noopener">View Media Guidelines</a>
          </div>
        </article>

        <article class="card">
          <div class="row-top"><h3 class="title">HRA Rates (2026)</h3><span class="tag">Reference</span></div>
          <p class="desc">Carrier HRA allowance details and benefit breakdowns.</p>
          <div class="actions">
            <a class="btn primary" href="https://gamma.app/docs/HRA-Rates-2026-w049xfpn49jd35b" target="_blank" rel="noopener">View HRA Rates</a>
          </div>
        </article>

        <article class="card">
          <div class="row-top"><h3 class="title">2026 Plan Comparison Grid</h3><span class="tag">Reference</span></div>
          <p class="desc">Compare plans, benefits, and competitive positioning across carriers.</p>
          <div class="actions">
            <a class="btn accent" href="https://docs.google.com/spreadsheets/d/13qp5zQ5FqnoxxOrcfabW21i_O-TZr4hP2UPbEKxoUXA/edit?usp=drive_link" target="_blank" rel="noopener">Open Plan Comparison Grid</a>
          </div>
        </article>

      </div>
    </section>

  </div>
</div>

<script>
(function () {
  var btn = document.getElementById("certBtn");
  var panel = document.getElementById("certPanel");
  if (!btn || !panel) return;

  btn.addEventListener("click", function () {
    panel.classList.toggle("closed");
    var expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!expanded));
  });
})();
</script>
