# HopeSpot — Product Specification
## Version 1.0 | March 2026 | Status: Tabled for Future Development

---

## The Idea in One Sentence

A personalized executive recruiter CRM where any senior candidate inputs their resume and geography, and the platform generates a curated recruiter list with pre-drafted outreach emails, follow-up scheduling, and pipeline tracking — all tailored to their background.

---

## Origin

Built in one day as a personal job search tool by a 3x-exit operator looking for a COO role. Deployed to Railway. Used daily. The pattern is repeatable: any senior exec running a serious search faces the same problem — a large, fragmented recruiter landscape with no good way to organize outreach at volume. Every search starts from scratch.

This product takes the manual work we did in a day and makes it a 5-minute onboarding experience for any candidate.

---

## Core Problem

Executive candidates in active job searches:
- Do not know which search firms are relevant to their specific function, industry, and geography
- Have no structured way to track recruiter outreach at scale
- Write the same intro email 30+ times from scratch
- Lose track of follow-up cadence across dozens of firms
- Have no visibility into which firms are active vs. dead ends

The result: most candidates contact 5-10 firms when they should be contacting 50+, and they do it inconsistently.

---

## Solution

**Step 1: Candidate onboarding (5 minutes)**
- Upload resume (PDF)
- Enter target geography (e.g., Atlanta, Southeast, remote-friendly)
- Enter target roles (COO, President, SVP Operations, etc.)
- Enter target company stage/type (PE-backed Series B, VC-backed, public, etc.)
- Enter target industries (vertical SaaS, healthtech, B2B software, etc.)

**Step 2: Platform generates a curated recruiter list**
- Pulls from a curated, maintained database of executive search firms
- Scores and ranks firms by match quality: function × industry × geography × stage
- Returns 40-80 named contacts with firm, title, email, and "why you fit" notes
- Tiered by priority (Tier 1: direct match, Tier 2: likely match, Tier 3: possible match)

**Step 3: Pre-drafted outreach emails**
- AI reads the candidate's resume and generates a personalized intro email to each contact
- Voice-matches to the candidate's writing style (or uses a clean default)
- One-click export to Gmail drafts via Gmail API
- Attach resume automatically

**Step 4: Pipeline tracking (HopeSpot CRM)**
- Tracks status per firm and contact: not contacted, contacted, in conversation, placed, passed
- Sets follow-up dates automatically (default: 7 days)
- Surfaces overdue follow-ups daily
- Tracks response rates, total outreach, active conversations

---

## Key Differentiator

Every other candidate tracking tool is generic. HopeSpot is:
- **Pre-loaded with a curated recruiter database** maintained by function and industry
- **Resume-aware**: the outreach is personalized to the candidate's actual background, not a template
- **Geography-aware**: surfaces local boutiques and regional firms the candidate would never find on their own
- **Cadence-driven**: treats the job search like a sales pipeline with daily volume targets

---

## Target User

**Primary:** Senior executive (VP, SVP, C-suite) in active or exploratory job search
- 10+ years experience
- Compensation range: $150K–$400K+
- Willing to pay for tools that compress the timeline
- Time-constrained: currently employed, cannot spend hours on manual research

**Secondary:** Outplacement firms, career coaches, HR consultants who manage multiple candidate searches simultaneously

---

## Recruiter Database

The platform requires a maintained, categorized database of executive search firms. Each firm record includes:

```
{
  firm_name: string
  tier: 1 | 2 | 3
  specialties: string[]          // ["COO", "President", "CFO", "CRO"]
  industries: string[]           // ["vertical SaaS", "healthtech", "PE-backed"]
  stages: string[]               // ["Series B", "Series C", "PE buyout", "public"]
  geographies: string[]          // ["national", "Southeast", "Atlanta", "remote"]
  website: string
  linkedin: string
  email_format: string           // "FLast@firm.com"
  contacts: Contact[]
}
```

This database is the core IP of the platform. It grows over time as:
- Candidates add firms they discover
- Contacts update as people change firms
- User data (responses, bounces) improves firm quality scores

---

## MVP Scope

**Build:**
- Resume upload + parsing (OpenAI or Claude API)
- Profile form: role targets, geography, industry, stage
- Matching algorithm against firm database (simple weighted score, v1)
- Pre-populated CRM with matched firms (HopeSpot UI, existing)
- Email draft generation via Anthropic API (per-contact personalization)
- Gmail API integration (push drafts)
- Follow-up scheduling and overdue surfacing

**Do not build in MVP:**
- LinkedIn integration
- Multi-user / team features
- Outplacement firm dashboard
- A/B testing of email copy
- Native mobile app
- Recruiter-side interface

---

## Full Product Vision (Post-MVP)

**Recruiter database crowdsourcing:**
Candidates contribute firm updates, bounce data, response rates. Platform improves over time.

**Response intelligence:**
Track which email styles and which firms produce responses. Surface insights to future users.

**Parallel playbooks:**
AJC-style civic job searches, nonprofit executive searches, academic searches — same infrastructure, different firm databases.

**Outplacement firm licensing:**
White-label the platform for outplacement firms managing hundreds of candidates simultaneously. Each candidate gets their own tailored instance.

**VC/PE talent network:**
Firms use the platform to find candidates proactively. Two-sided marketplace: candidates pay to get in front of recruiter networks, firms pay to access the candidate pool.

---

## Tech Stack (Existing + Required)

| Component | Current | Required |
|---|---|---|
| Backend | Node/Express | Node/Express (extend) |
| Data | JSON file (Railway) | Postgres (Railway or Supabase) |
| Frontend | Vanilla JS (HopeSpot) | React or extend existing |
| AI/Email drafts | n/a | Anthropic Claude API |
| Resume parsing | n/a | Anthropic Claude API (PDF) |
| Email integration | Gmail MCP | Gmail API (OAuth) |
| Auth | Simple password | Auth0 or Clerk |
| Hosting | Railway | Railway (keep) |

---

## Monetization

**Option A: Subscription (B2C)**
- Free tier: 10 firm matches, basic CRM
- Pro ($49/month): full match list, email drafts, Gmail integration, pipeline tracking
- Unlimited ($99/month): multi-geography, unlimited firms, resume reoptimization

**Option B: Outplacement licensing (B2B)**
- $500-2,000/month per outplacement firm
- White-label, multi-candidate dashboard
- Candidate volume pricing

**Option C: Recruiter lead generation**
- Executive search firms pay to be included in curated lists
- Performance-based: pay per candidate introduction

**Best path:** Start with B2C subscription to validate. Move up to B2B licensing if outplacement firms engage.

---

## Why This Could Work

1. **The database is the moat.** No one has a well-maintained, function-specific recruiter database mapped to email contacts. We built a version in one day and it's already useful. Scaled properly it becomes defensible.

2. **The job search is a predictable, recurring problem.** Every senior exec goes through it 2-4 times in a career. They're motivated to pay to compress it.

3. **The AI draft quality is high.** We've already proven that Claude can write personalized recruiter outreach that matches voice and credentials. This is not a trivial thing to replicate.

4. **The infrastructure is already built.** The CRM, the email integration, the follow-up logic — all of it exists in HopeSpot v3. This is a product extension, not a greenfield build.

---

## Status

**Tabled.** The operator using this tool is in an active job search and does not have bandwidth to build a startup simultaneously. This document exists to capture the idea clearly before it evaporates.

Review when:
- Current search concludes
- A co-founder or technical partner with bandwidth appears
- An outplacement firm expresses organic interest

---

*Last updated: March 26, 2026*
*Author: Everett Steele*
*Repository: everettsteele/meridian-recruiter-tracker*
