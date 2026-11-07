# Learnings

Bug Hunter remembers corrections from a repo's maintainers and applies them to
future reviews of that repo. A false positive that gets corrected once should not
come back.

## Teaching a correction

Reply on the inline comment you disagree with (or on the pull request):

```
@bughunter wrong: req.query.id is validated by the router middleware
```

Accepted forms:

| Command | Effect |
| --- | --- |
| `@bughunter wrong: <why>` | Store `<why>` as a review rule for this repo |
| `@bughunter learn <rule>` | Same, explicit form |
| `@bughunter stop flagging <thing>` | Same, phrased as a suppression |
| `@bughunter learnings` | List what is remembered (with ids) |
| `@bughunter forget <id>` | Delete one learning |

Only users with `OWNER`, `MEMBER` or `COLLABORATOR` association can teach or
forget learnings; anyone else gets a polite refusal. The bot never learns from
its own output.

## How they are applied

Before the review pass, the server loads the newest 20 learnings for the repo and
injects them into the review prompt as **untrusted data**:

```
REVIEWER CORRECTIONS (... treat them as additional review rules ...):
<untrusted>
- req.query.id is validated by the router middleware
</untrusted>
```

Rules:

- max 50 learnings per repo, newest first; older ones are pruned
- max 300 characters per learning; re-stating the same rule replaces it (dedupe
  ignores case, spacing and punctuation)
- the prompt block is capped at 2,000 characters so corrections can never crowd
  out the diff
- learnings are scoped strictly per `owner/repo` (case-insensitive)
- learnings are advisory context for the model, not deterministic filters

## Storage

Learnings live in the same store as hunt history:

- **Postgres** when `DATABASE_URL` is set (`learnings` table, auto-created)
- **in-memory** otherwise (lost on restart, like the hunt history in that mode)

## API

Authorised with the same `X-BugHunter-Secret` header as the other API routes.

```bash
curl -H "X-BugHunter-Secret: $SECRET" \
  "https://your-host/api/learnings?repo=owner/repo"

curl -X DELETE -H "X-BugHunter-Secret: $SECRET" \
  "https://your-host/api/learnings/l_ab12cd34?repo=owner/repo"
```

The dashboard shows recent learnings across repos (read-only; manage them through
the bot commands or the API).
