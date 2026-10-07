# Chatze Nepal Edition: Anti-Spam, Security & Quota Protection Architecture
## "The Static Letterbox" System Design Specification

---

## 1. Executive Summary & The Problem

Chatze is designed as a decentralized, self-deployable, edge-native chatting platform for Nepal. Every user or shop can deploy their own instance on Cloudflare Workers backed by Cloudflare D1.

### 1.1 The Vulnerability: The "Doorbell" (Denial-of-Wallet / Quota Exhaustion)
* **The Reality of Serverless**: On the Cloudflare Workers Free Tier, every deployment receives **100,000 free requests per day**.
* **The Exploit**: If an attacker forks the repository or runs an automated bot script, they could blast a victim's worker (`https://victim-shop.workers.dev/api/inquiries`) with 100,000 requests in 10 minutes.
* **The Impact**: Even if the victim's server rejects every request in 1 millisecond, Cloudflare still counts each HTTP hit as **1 Worker Invocation**. The victim's daily quota gets wiped out, and the shop shuts down with `Error 1015 / 1102`.

### 1.2 The Subdomain Trick (Evading Basic IP/Domain Bans)
* A malicious actor can register one domain (e.g., `attacker.com`) and programmatically generate infinite subdomains:
  `bot1.attacker.com`, `bot2.attacker.com`, `bot3.attacker.com`...
* If an anti-spam system only blocks the exact string `bot1.attacker.com`, the attacker simply switches to `bot2.attacker.com` and continues the attack.

### 1.3 The Nepal Network Reality (The CGNAT Constraint)
* In Nepal, mobile telcos (**Ncell, Nepal Telecom**) and major ISPs (**WorldLink, Vianet**) use **Carrier-Grade NAT (CGNAT)**.
* **Thousands of legitimate mobile phones share the exact same public IP address**.
* A naive IP-based ban (`limit 3 requests per IP`) would accidentally block real Nepali customers sitting in the same college, cafe, or cell tower.

---

## 2. Core Architecture: "The Static Letterbox"

To protect business accounts and personal users from quota exhaustion without breaking peer-to-peer federation, Chatze implements the **Static Letterbox Model**.

```
[ Visitor / Customer ]
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: 100% Static Edge Delivery (Cloudflare CDN Assets) │
│  - Serves shop inquiry page from CDN cache                  │
│  - Cost: 0 Worker Invocations, 0 Database Writes            │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: Cloudflare Turnstile Invisible Shield             │
│  - Verifies human presence in real browser                  │
│  - Python / cURL / headless bot scripts fail & get dropped  │
│  - Runs at Cloudflare Edge: 0 Worker CPU consumed           │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: Root Domain (eTLD+1) Wildcard Deduplication       │
│  - Strips subdomains (e.g. *.attacker.com -> attacker.com) │
│  - Rule: Max 1 pending inquiry per Root Domain / Sender     │
│  - Duplicates rejected instantly                            │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 4: The 1-Card Gate (The Static Letterbox)            │
│  - Customer can only write ONE inquiry card                 │
│  - Further messages LOCKED until shop owner reviews         │
│  - Drops note into Shop's "Customer Notes" Inbox            │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 5: Shop Owner Dashboard                              │
│  - Owner reviews static cards: [ Reply ] or [ Dismiss ]     │
│  - Reply unlocks full 2-way live chat                       │
│  - Dismiss permanently blocks the root domain               │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Breakdown

### 3.1 Phase 1: Static Edge Delivery (Zero Server Cost)
* The customer inquiry interface (`/shop/@handle/inquiry`) is served directly from Cloudflare’s global edge cache (`env.ASSETS`).
* Loading the page, viewing products, and reading shop info costs **zero compute** on the shop owner's Cloudflare Worker.

### 3.2 Phase 2: Invisible Turnstile Shield (Bot Filter)
* Before the "Submit Inquiry" button can dispatch any network request, Cloudflare Turnstile validates the client silently in the background.
* Automated bot scripts attempting direct HTTP POST attacks without a valid Turnstile token are dropped at Cloudflare's network layer before the Worker code executes.

### 3.3 Phase 3: Root Domain (eTLD+1) Wildcard Deduplication
To prevent attackers from using subdomains to bypass rate limits:
1. When an incoming request arrives from a remote instance or origin, the server extracts the **Effective Top-Level Domain plus one label (eTLD+1)**:
   * `bot1.evil-attacker.com` $\longrightarrow$ `evil-attacker.com`
   * `bot2.evil-attacker.com` $\longrightarrow$ `evil-attacker.com`
   * `api.staging.evil-attacker.com` $\longrightarrow$ `evil-attacker.com`
2. **Wildcard Rule**: The system tracks pending inquiries by the **Root Domain**, not the subdomain.
3. If `evil-attacker.com` already has 1 pending inquiry in the queue, **all subdomains of `evil-attacker.com` are blocked**.

### 3.4 Phase 4: The 1-Card Gate (Anti-Flood)
* A customer or remote instance is restricted to dropping **exactly 1 message card** (e.g., *"Dai, do you have black jacket in L size?"*).
* The sender cannot send message #2, #3, or #4. The UI displays:
  > *"Your note has been placed in the shop's inbox. Please wait for the owner to reply."*
* This makes automated message flooding structurally impossible.

### 3.5 Phase 5: Shop Owner Review Dashboard
When the shop owner logs into Chatze:
* They navigate to **"Customer Inquiries"** (The Letterbox).
* Inquiries are displayed as static cards showing:
  * Customer Name / Handle
  * Message content
  * Timestamp & Verified Root Domain
* **Action Buttons**:
  * **`[ Reply ]`**: Accepts the conversation, initiates two-way messaging, and creates a private chat room.
  * **`[ Dismiss / Block ]`**: Discards the card and places the root domain on the instance's local blocklist.

---

## 4. Personal Accounts: "Friend PIN & QR Handshake"

For individual personal accounts (e.g., friends, family, students), the attack vector is spam friend requests.

### 4.1 Scannable QR Code & Friend PIN
* Every personal account generates a 6-character alphanumeric Friend PIN (e.g., `NP-7429`) and a scannable QR code.
* Friends can add each other in two friction-free ways:
  1. **Scan QR Code**: When meeting in person at a cafe, college, or office.
  2. **Direct Link**: `https://chatze.app/@aarav?pin=NP-7429`

### 4.2 Max 5 Pending Requests Ceiling
* If an unknown party attempts to guess handles and send blind friend requests:
* The recipient's inbox enforces a hard ceiling of **5 pending requests**.
* If 5 requests are already awaiting review, any new request from an unverified stranger is rejected immediately (`429 Queue Full`).
* This guarantees that a personal account's D1 storage and notification queue will never be filled with spam.

### 4.3 Telegram-Style Inline Actions
* Incoming friend requests feature three immediate actions:
  * **`[ Accept ]`** $\longrightarrow$ Adds to friends list.
  * **`[ Ignore ]`** $\longrightarrow$ Silently removes the request without alerting the sender.
  * **`[ Block ]`** $\longrightarrow$ Blacklists the sender handle and sending instance permanently.

---

## 5. Resource Consumption & Cloudflare Free Tier Safety

| Operation | Standard Open Setup | Static Letterbox Setup | Safety Advantage |
| :--- | :--- | :--- | :--- |
| **Visiting Shop / Viewing Info** | 1 Worker Invocation | **0 Invocations** (CDN Cache) | Infinite free views |
| **Bot Script Spam Blast (10k requests)** | 10,000 Invocations (Quota drained) | **0 Invocations** (Blocked at Turnstile Edge) | 100% quota protected |
| **Subdomain Exploit (`bot*.domain`)** | Bypasses standard bans | **Blocked** via eTLD+1 Root Matching | Cannot bypass with subdomains |
| **Customer Inquiry Submission** | Unlimited flood | **Strictly 1 card** until owner replies | 0 message spam |
| **Pending Inquiries Storage** | Uncapped database bloat | **Capped queue** (Max 20 per shop) | D1 free limit preserved |

---

## 6. Implementation Readiness Checklist

- [x] Architecture fully documented and validated against Cloudflare Workers constraints.
- [ ] D1 Table Schema: `static_inquiries` table with `root_domain` and `sender_fingerprint` uniqueness constraint.
- [ ] Root Domain Parser utility (eTLD+1 extraction).
- [ ] Static inquiry submission UI with Cloudflare Turnstile validation.
- [ ] Business Owner Dashboard: "Customer Inquiries" card review panel with `[ Reply ]` and `[ Dismiss ]`.
- [ ] Personal Account: Friend PIN and QR code generation with 5-request queue limit.
