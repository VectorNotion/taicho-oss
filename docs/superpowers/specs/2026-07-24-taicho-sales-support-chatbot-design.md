# Taicho Chatbots

## 1. Problem → Shape

```mermaid
flowchart LR
    subgraph TODAY["TODAY · DISCONNECTED"]
        V1["Public visitor"] --> P1["Static product pages"]
        P1 --> X1["Questions unanswered"]
        X1 --> X2["Lead lost"]

        U1["Signed-in user"] --> D1["Search docs manually"]
        U1 --> O1["Workspace Assistant"]
        O1 --> O2["Operational tools"]
        D1 --> X3["Support dead end"]
        X3 --> DS1["Discord"]
        X3 --> T1["Payload ticket"]
    end

    subgraph TOMORROW["TARGET · ONE CHAT SYSTEM"]
        V2["Public visitor"] --> SB["Sales Assistant"]
        SB --> L2["Qualified lead"]

        U2["Signed-in user"] --> SP["Support Assistant"]
        SP --> R2["Cited docs answer"]
        SP --> H2["Human handoff"]

        U2 --> OA["Workspace Assistant"]
        OA --> A2["Product actions"]

        SB --> C2["Taicho Chat v1"]
        SP --> C2
        OA -.->|separate policy| C2
    end

    classDef person fill:#172554,stroke:#60a5fa,color:#fff
    classDef bad fill:#7f1d1d,stroke:#fca5a5,color:#fff
    classDef sales fill:#064e3b,stroke:#6ee7b7,color:#fff
    classDef support fill:#7c2d12,stroke:#fdba74,color:#fff
    classDef core fill:#312e81,stroke:#c4b5fd,color:#fff
    classDef action fill:#1f2937,stroke:#9ca3af,color:#fff

    class V1,U1,V2,U2 person
    class X1,X2,X3 bad
    class SB,L2 sales
    class SP,R2,H2 support
    class C2 core
    class P1,D1,O1,O2,DS1,T1,OA,A2 action
```

## 2. System

```mermaid
flowchart TB
    subgraph WEB["PUBLIC · taicho.ai"]
        WIDGET["Sales widget"]
        BFF["Same-origin proxy<br/>Turnstile · rate limit · HMAC"]
        WIDGET --> BFF
    end

    subgraph APP["AUTHENTICATED · app.taicho.ai"]
        HELP["Help / Support UI"]
        AUTH["Better Auth<br/>user · organization · plan"]
        HELP --> AUTH
    end

    subgraph CORE["CHAT CORE · content-automation"]
        GATE["Taicho Chat v1 gateway"]
        ROUTE{"Surface policy"}
        SALES["Sales policy"]
        SUPPORT["Support policy"]
        MODEL["routerModel<br/>OpenRouter"]
        MEMORY[("Postgres<br/>conversation memory")]

        GATE --> ROUTE
        ROUTE -->|"sales"| SALES
        ROUTE -->|"support"| SUPPORT
        SALES --> MODEL
        SUPPORT --> MODEL
        GATE <--> MEMORY
    end

    subgraph KNOWLEDGE["EVIDENCE"]
        FACTS["Approved sales facts"]
        DOCS["docs.taicho.ai<br/>MDX corpus"]
        INDEX[("Postgres<br/>text + embeddings")]
        DOCS --> INDEX
    end

    subgraph PAYLOAD["PAYLOAD · OPERATIONS"]
        LEADS[("Leads")]
        TICKETS[("Tickets")]
        MESSAGES[("Messages")]
        EVENTS[("Events + SLA")]
    end

    BFF --> GATE
    AUTH --> GATE
    SALES --> FACTS
    SALES --> LEADS
    SUPPORT --> INDEX
    SUPPORT --> TG["Stateless ticket gateway"]
    TG --> TICKETS
    TG --> MESSAGES
    TG --> EVENTS

    classDef boundary fill:#111827,stroke:#6b7280,color:#fff
    classDef core fill:#312e81,stroke:#c4b5fd,color:#fff
    classDef sales fill:#064e3b,stroke:#6ee7b7,color:#fff
    classDef support fill:#7c2d12,stroke:#fdba74,color:#fff
    classDef data fill:#1f2937,stroke:#f3f4f6,color:#fff

    class WIDGET,BFF,HELP,AUTH boundary
    class GATE,ROUTE,MODEL core
    class SALES,FACTS,LEADS sales
    class SUPPORT,DOCS,INDEX,TG,TICKETS,MESSAGES,EVENTS support
    class MEMORY data
```

## 3. Shared Chat Contract

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant G as Chat v1 Gateway
    participant P as Surface Policy
    participant M as Model
    participant A as Lead / Ticket Action

    C->>G: ChatRequest v1<br/>requestId · conversationId · surface · message
    G->>G: Validate version · size · idempotency
    G-->>C: conversation.ready
    G->>P: Trusted identity + trusted page context
    P-->>C: assistant.ack
    P->>M: Policy + evidence + bounded history

    loop Visible answer
        M-->>P: Text delta
        P-->>C: assistant.delta
    end

    opt Grounded support answer
        P-->>C: citation.added
    end

    opt Approved business action
        P->>A: Idempotent command
        A-->>P: Confirmed result
        P-->>C: lead.state.updated / support.ticket.created
    end

    P-->>C: suggestions.updated
    P-->>C: assistant.completed
```

```mermaid
flowchart LR
    REQ["REQUEST<br/>v1 · requestId · conversationId<br/>surface · message · page context"] --> ENV["EVENT ENVELOPE<br/>eventId · sequence · timestamp<br/>conversationId · requestId"] --> EVT{"EVENTS"}

    EVT --> TEXT["assistant.ack<br/>assistant.delta<br/>assistant.completed"]
    EVT --> PROOF["citation.added"]
    EVT --> SALES["lead.state.updated"]
    EVT --> SUPPORT["support.escalation.offered<br/>support.ticket.created<br/>support.discord.available"]
    EVT --> UX["suggestions.updated<br/>activity.updated"]
    EVT --> ERR["error<br/>code · message · retryable"]

    classDef core fill:#312e81,stroke:#c4b5fd,color:#fff
    classDef sales fill:#064e3b,stroke:#6ee7b7,color:#fff
    classDef support fill:#7c2d12,stroke:#fdba74,color:#fff
    classDef error fill:#7f1d1d,stroke:#fca5a5,color:#fff
    classDef neutral fill:#1f2937,stroke:#9ca3af,color:#fff

    class REQ,ENV,EVT core
    class SALES sales
    class SUPPORT,PROOF support
    class ERR error
    class TEXT,UX neutral
```

## 4. Sales Assistant

```mermaid
stateDiagram-v2
    [*] --> Question
    Question --> ApprovedAnswer: approved facts + page map

    ApprovedAnswer --> ExistingCustomer: support intent
    ExistingCustomer --> SupportLink
    SupportLink --> [*]

    ApprovedAnswer --> ContinueBrowsing: low intent
    ContinueBrowsing --> Question

    ApprovedAnswer --> Consent: buying intent
    Consent --> Question: declined
    Consent --> Email: accepted
    Email --> Qualification
    Qualification --> Name
    Qualification --> Company
    Qualification --> Role
    Qualification --> UseCase
    Qualification --> Timeframe
    Qualification --> PlanInterest

    Name --> Lead
    Company --> Lead
    Role --> Lead
    UseCase --> Lead
    Timeframe --> Lead
    PlanInterest --> Lead
    Qualification --> Lead: enough context

    Lead --> Payload
    Payload --> CTA
    CTA --> [*]
```

```mermaid
flowchart LR
    PAGE["Trusted page path"] --> MAP["Server page map"] --> FACTS["Approved facts<br/>product · plans · pricing · enterprise"] --> ANSWER["Useful answer first"] --> INTENT{"Buying intent?"}

    INTENT -->|"No"| NEXT["Question / trusted CTA"]
    INTENT -->|"Yes"| CONSENT{"Consent?"}
    CONSENT -->|"No"| NEXT
    CONSENT -->|"Yes"| FIELDS["Email + optional qualification"]
    FIELDS --> SUMMARY["Factual summary"]
    SUMMARY --> LEAD[("Payload Lead<br/>tenant = taicho<br/>source = sales_bot")]

    CLIENT["Client page title / text"] -.->|display only| PAGE
    CLIENT -.->|never trusted instructions| FACTS

    classDef trusted fill:#064e3b,stroke:#6ee7b7,color:#fff
    classDef decision fill:#312e81,stroke:#c4b5fd,color:#fff
    classDef untrusted fill:#7f1d1d,stroke:#fca5a5,color:#fff

    class PAGE,MAP,FACTS,ANSWER,NEXT,FIELDS,SUMMARY,LEAD trusted
    class INTENT,CONSENT decision
    class CLIENT untrusted
```

## 5. Support Assistant

```mermaid
flowchart TB
    Q["Authenticated question"] --> CLASSIFY["Intent + safety classification"] --> SEARCH["Hybrid retrieval"]

    subgraph RAG["DOCS RAG"]
        MDX["docs/content/**/*.mdx"]
        CORPUS["Versioned corpus<br/>URL · heading · hash · commit"]
        CHUNKS["Heading chunks<br/>400–800 tokens"]
        LEX["Postgres full-text rank"]
        SEM["Embedding cosine rank"]
        FUSE["Rank fusion<br/>max 5 chunks · max 3 pages"]

        MDX --> CORPUS --> CHUNKS
        CHUNKS --> LEX
        CHUNKS --> SEM
        LEX --> FUSE
        SEM --> FUSE
    end

    SEARCH --> FUSE
    FUSE --> CONF{"Evidence strong?"}
    CONF -->|"Yes"| ANSWER["Grounded answer"]
    ANSWER --> CITE["Docs citations"]
    CITE --> HELP{"Helpful?"}
    HELP -->|"Yes"| DONE["Resolved"]
    HELP -->|"No"| CLARIFY["Focused clarification"]

    CONF -->|"No"| CLARIFY
    CLARIFY --> RETRY["Retrieve again"]
    RETRY --> CONF2{"Evidence strong?"}
    CONF2 -->|"Yes"| ANSWER
    CONF2 -->|"No"| ESC["Offer human escalation"]

    classDef source fill:#1f2937,stroke:#f3f4f6,color:#fff
    classDef core fill:#312e81,stroke:#c4b5fd,color:#fff
    classDef support fill:#7c2d12,stroke:#fdba74,color:#fff
    classDef success fill:#064e3b,stroke:#6ee7b7,color:#fff

    class MDX,CORPUS,CHUNKS,LEX,SEM,FUSE source
    class Q,CLASSIFY,SEARCH,CONF,HELP,CONF2 core
    class ANSWER,CITE,CLARIFY,RETRY,ESC support
    class DONE success
```

## 6. Human Handoff

```mermaid
flowchart LR
    START["Support conversation"] --> SIGNAL{"Escalation signal"}

    SIGNAL -->|"Human requested"| OFFER["Offer handoff"]
    SIGNAL -->|"2 failed answers"| OFFER
    SIGNAL -->|"2 unhelpful ratings"| OFFER
    SIGNAL -->|"Account · billing · security"| OFFER
    SIGNAL -->|"Data loss · outage"| URGENT["Urgent handoff"]

    OFFER --> CONFIRM{"User confirms?"}
    CONFIRM -->|"No"| CHAT["Continue chat"]
    CONFIRM -->|"Yes"| KEY["Idempotency key"]
    URGENT --> KEY

    KEY --> GATE["Stateless Payload gateway"]
    GATE --> T["Create ticket"]
    GATE --> M["Copy public transcript"]
    GATE --> E["Create audit events + SLA"]

    T --> RESULT["Ticket number + status"]
    M --> RESULT
    E --> RESULT
    RESULT --> UI["In-app confirmation"]
    RESULT --> DISCORD["Configured Discord link"]

    classDef signal fill:#312e81,stroke:#c4b5fd,color:#fff
    classDef support fill:#7c2d12,stroke:#fdba74,color:#fff
    classDef urgent fill:#7f1d1d,stroke:#fca5a5,color:#fff
    classDef success fill:#064e3b,stroke:#6ee7b7,color:#fff

    class SIGNAL,CONFIRM signal
    class OFFER,KEY,GATE,T,M,E,CHAT support
    class URGENT urgent
    class RESULT,UI,DISCORD success
```

```mermaid
sequenceDiagram
    autonumber
    participant U as Support user
    participant S as Support Assistant
    participant G as Stateless Gateway
    participant P as Payload
    participant D as Discord
    participant A as Support agent

    U->>S: Confirm human handoff
    S->>G: Escalation + trusted tenant mapping + idempotency key
    G->>P: Create ticket
    G->>P: Create customer + bot messages
    P->>P: Status · severity · SLA · audit events
    P-->>G: ticketId · ticketNumber · status
    G-->>S: Confirmed ticket
    S-->>U: Ticket number + status
    S-->>U: Configured Discord link
    D-->>U: Community / direct support
    P-->>A: Tenant-scoped support queue
```

## 7. Data Ownership

```mermaid
flowchart TB
    subgraph SOURCE["WEBSITES REPOSITORY"]
        SALESFACTS["Approved sales facts"]
        DOCMDX["Documentation MDX"]
        WIDGET["Sales widget"]
    end

    subgraph AUTHSTORE["BETTER AUTH"]
        USER["User"]
        ORG["Organization"]
        ROLE["Role + plan + capabilities"]
    end

    subgraph PG["POSTGRES · CHAT + RAG"]
        THREADS["Support threads"]
        ANON["Anonymous sales threads<br/>30 days"]
        DOCINDEX["Docs chunks + embeddings"]
        IDEM["Request + escalation idempotency"]
    end

    subgraph CMS["PAYLOAD · BUSINESS OPERATIONS"]
        LEAD["Sales leads"]
        TICKET["Support tickets"]
        MESSAGE["Ticket messages"]
        EVENT["Audit events + SLA"]
        AGENT["Support agents"]
    end

    SALESFACTS --> ANON
    DOCMDX --> DOCINDEX
    USER --> THREADS
    ORG --> THREADS
    ROLE --> THREADS
    WIDGET --> ANON
    ANON --> LEAD
    THREADS --> TICKET
    THREADS --> MESSAGE
    TICKET --> EVENT
    AGENT --> TICKET

    DOCMDX -.->|NO COPY| BLOCK["No docs or embeddings in Payload"]

    classDef source fill:#172554,stroke:#60a5fa,color:#fff
    classDef auth fill:#312e81,stroke:#c4b5fd,color:#fff
    classDef postgres fill:#1f2937,stroke:#f3f4f6,color:#fff
    classDef payload fill:#7c2d12,stroke:#fdba74,color:#fff
    classDef block fill:#7f1d1d,stroke:#fca5a5,color:#fff

    class SALESFACTS,DOCMDX,WIDGET source
    class USER,ORG,ROLE auth
    class THREADS,ANON,DOCINDEX,IDEM postgres
    class LEAD,TICKET,MESSAGE,EVENT,AGENT payload
    class BLOCK block
```

## 8. Tenant + Trust Boundaries

```mermaid
flowchart LR
    subgraph BROWSER["UNTRUSTED BROWSER"]
        MSG["Message"]
        PATH["Page path"]
        BAD1["organizationId"]
        BAD2["tenantId"]
        BAD3["system prompt"]
    end

    subgraph SERVER["TRUSTED SERVER"]
        SALESID["Sales identity<br/>fixed surface + Taicho tenant"]
        AUTH["Better Auth context"]
        NS["Memory namespace<br/>support:organization:user"]
        MAP["Organization → CMS tenant mapping"]
        POLICY["Tool allowlist"]
    end

    subgraph DATA["ENFORCED DATA LAYERS"]
        PG[("Postgres ownership")]
        CMS[("Payload tenant access")]
        SERVICE["Scoped service credential"]
    end

    MSG --> POLICY
    PATH --> SALESID
    SALESID --> CMS

    AUTH --> NS --> PG
    AUTH --> MAP --> SERVICE --> CMS

    BAD1 -.->|ignored| AUTH
    BAD2 -.->|ignored| MAP
    BAD3 -.->|never accepted| POLICY

    POLICY --> SAFE["Sales: facts + lead capture<br/>Support: docs + ticket gateway<br/>Workspace: separate agent"]

    classDef untrusted fill:#7f1d1d,stroke:#fca5a5,color:#fff
    classDef trusted fill:#312e81,stroke:#c4b5fd,color:#fff
    classDef enforced fill:#064e3b,stroke:#6ee7b7,color:#fff

    class MSG,PATH,BAD1,BAD2,BAD3 untrusted
    class SALESID,AUTH,NS,MAP,POLICY trusted
    class PG,CMS,SERVICE,SAFE enforced
```

## 9. Code Map

```mermaid
flowchart LR
    subgraph WEBSITES["websites"]
        WC["chat-contract generated"]
        WUI["shared chat widget"]
        WBFF["taicho /api/chat/sales"]
        WFACT["sales facts + page map"]
        WDOC["docs corpus exporter"]
        WLEAD["Payload Leads"]
        WGATE["Payload escalation gateway"]
    end

    subgraph CONTENT["content-automation"]
        CONTRACT["packages/chat-contract<br/>canonical schema + fixtures"]
        CHAT["packages/chat<br/>gateway + stream + persistence"]
        SALES["packages/chat/sales"]
        SUPPORT["packages/chat/support"]
        RAG["packages/chat/retrieval"]
        TICKETS["packages/chat/tickets"]
        SUI["/support UI + routes"]
        EXISTING["Existing /chat Assistant"]
    end

    CONTRACT -->|"generate"| WC
    WC --> WUI
    WUI --> WBFF
    WFACT --> WBFF
    WBFF --> CHAT
    CHAT --> SALES
    CHAT --> SUPPORT
    SUPPORT --> RAG
    SUPPORT --> TICKETS
    TICKETS --> WGATE
    WDOC --> RAG
    SALES --> WLEAD
    SUPPORT --> SUI
    EXISTING -.->|UI primitives only| SUI

    classDef repo1 fill:#172554,stroke:#60a5fa,color:#fff
    classDef repo2 fill:#312e81,stroke:#c4b5fd,color:#fff
    classDef separate fill:#7f1d1d,stroke:#fca5a5,color:#fff

    class WC,WUI,WBFF,WFACT,WDOC,WLEAD,WGATE repo1
    class CONTRACT,CHAT,SALES,SUPPORT,RAG,TICKETS,SUI repo2
    class EXISTING separate
```

## 10. Delivery

```mermaid
flowchart LR
    P0["0 · CONTRACT<br/>schemas · fixtures · SSE<br/>idempotency · generic UI"]
    --> P1["1 · SALES<br/>facts · widget · consent<br/>leads · abuse controls"]
    --> P2["2 · SUPPORT<br/>docs export · RAG<br/>citations · support UI"]
    --> P3["3 · HANDOFF<br/>stateless gateway<br/>tickets · transcript · Discord"]
    --> P4["4 · QUALITY<br/>evaluations · dashboards<br/>ticket status · private sources"]

    P0 -.-> G0{"Contract fixtures pass"}
    P1 -.-> G1{"Correct facts<br/>consented lead"}
    P2 -.-> G2{"Cited answer<br/>tenant isolation"}
    P3 -.-> G3{"One escalation<br/>one ticket"}
    P4 -.-> G4{"Measured scale<br/>measured quality"}

    classDef phase fill:#312e81,stroke:#c4b5fd,color:#fff
    classDef gate fill:#064e3b,stroke:#6ee7b7,color:#fff

    class P0,P1,P2,P3,P4 phase
    class G0,G1,G2,G3,G4 gate
```
