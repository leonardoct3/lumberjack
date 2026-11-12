# Assisted Inbox: design

PR 5 of the agentic evolution plan. Shadow resolution proposals become suggestions in the existing Inbox. Nothing is linked without an operator click, so the board stays operator-authoritative, and every click is recorded as the acceptance evidence the promotion gate asks for.

## Scope

- In: orphan signals (pista messages without a signal). Suggestions, clusters by proposed festa, bulk link with undo, feedback records, acceptance counts in `pipeline status`, a flag.
- Out: party candidates (duplicate announcements, merges), the unclassified list, any automatic linking.

## Flag

`PIPELINE_INBOX=off|suggest`, default `off`, read by the web service. With `off` the Inbox renders and records exactly as today. It does not depend on the other pipeline flags: the web service only reads proposals the worker already wrote. An invalid pipeline configuration on the web service is treated as `off`, so a bad flag never takes the Inbox down.

## Suggestion for one message

The message's current proposals are those of the accepted run (`resultRunId`) of its most recently completed, succeeded `resolve` job. Proposals with `not_mentioned` carry no information and are ignored. Linked parties that are no longer `upcoming` are dropped, since the operator cannot link to them.

| Remaining proposals                                          | Suggestion                                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| none, or no resolve job yet                                  | none: today's matcher default is kept                                                                                                   |
| all `link` to one upcoming party                             | `link` to that party                                                                                                                    |
| only `new_event`                                             | `new_event`, with the mention as the name and the observed date when the interpreter gave day, month and year                           |
| anything else (abstention, two parties, link plus new event) | `doubt`: the linked parties and the top three shortlisted upcoming parties as options, with the resolver's reasons; nothing preselected |

Every suggestion carries the evidence spans of its observations, drawn as highlights over the message text, and the run id.

## Clusters

Orphans whose suggestion is `link` are grouped by party into clusters, shown above the remaining orphans. Clusters are ordered by downstream effect: the sum over members of the number of groups that saw the message, ties broken by size. Each member shows its evidence and a checkbox, ticked by default. "Vincular N" links the ticked members through the existing `linkOrphans`. The success toast offers "Desfazer", which removes exactly the signals that batch created.

Orphans with `doubt` or `new_event` stay in the normal list with a note. `new_event` prefills the create form. Orphans with no suggestion look as they do today.

## Feedback

A new additive table, `ProposalReview`, holds one row per operator action on an orphan while the flag is `suggest`:

- `messageId`, `action` (`linked`, `created`, `dismissed`, `undone`), `chosenPartyId`;
- `suggestion` (`link`, `new_event`, `doubt`, or null when there was none), `suggestedPartyId`, `runId`;
- `createdAt`.

The server action computes the suggestion itself at the moment of the action, so the record never trusts what the browser sent. Recording runs after the mutation and only logs on failure: a feedback problem must not turn a completed link into an error toast.

Acceptance is derived, not stored: a `link` suggestion is accepted when the action is `linked` to the suggested party, and changed when it is linked elsewhere, created or dismissed. `pipeline status` reports counts by suggestion and outcome.

## Undo

`undoLinks(db, { partyId, messageIds })` deletes, in one transaction, the signals of those messages that point at that party, clears `Message.partyId`, and returns the messages it unlinked, which are recorded as `undone`. The bulk action returns the ids it actually linked, and undo uses exactly those, so a message linked by someone else in the meantime is not touched.

## Errors and edges

- A party merged, discarded or past since the resolve run is dropped from suggestions and options.
- Linking skips messages that gained a signal meanwhile (existing behaviour); they are not in the returned ids.
- Proposals reference parties without a foreign key; names come from the current catalog, never from the proposal.

## Testing

- Pure: suggestion from proposals (each table row, inactive party, not_mentioned only), clusters and ordering, span highlighting with overlapping and out-of-range spans.
- Database: loading the current suggestion (latest job wins, failed jobs ignored), review recording for each action, undo removing only the batch, status acceptance counts.
- Config: the new flag and its default.
