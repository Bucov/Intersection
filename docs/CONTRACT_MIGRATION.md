# Backend v1 additive integration fields

The existing routes, coordinates, phase names, `sequence` and physics `stateVersion`
retain their meanings. Backend snapshots additionally expose `decisionStateVersion`,
`snapshotSequence` and `eventSequence` (`sequence` alias). Decision revision changes on
cycle admission, signal-plan commit/transition, injection, pause and reset; never on an
ordinary physics step. New generations do not reset lifetime sequence counters.

Agent status optionally identifies `provider` (`gemini`, `claude`, `mock`). Existing
`providers[0]` retains its legacy `gemini` discriminator as the aggregate proposal-service
slot; its readiness/reason covers both independently configured agents. Agent cards show
the actual per-agent provider/model. `providers[1].mode` may differ from agent/demo mode
when `JEV_MODE` is explicit. Older frontend browser mocks remain supported.

Arbitration records optionally carry the lossless `adapterResult`, `bridgePhase`,
`bridgeReason`, and `decisionStateVersion`. Adapter candidate-ID probabilities, separate
abstain probability, null confidence, source, measurements and latency are preserved.
The legacy `result` is only a presentation projection when all its stricter measurements
exist and its distribution can be represented without changing any number. A completed
record may therefore have `result:null` and `adapterResult`; clients must not assert a
non-null legacy result. Bridge failures can contain a safe reason without a provider result.

Metrics add timeAverageQueueLength (integral of queue count / elapsed simulation ms)
and maximumObservedDelayMs (maximum accrued upstream plus stopped wait, including
incomplete demand). Existing completed-trip metrics retain their denominators.
