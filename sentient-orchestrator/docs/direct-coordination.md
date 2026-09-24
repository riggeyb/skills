# Direct Sentient coordination

Direct coordination is a durable, provider-independent control-plane capability. PostgreSQL remains the source of truth for messages, concrete deliveries, retry state, and acknowledgements.

The runtime binds every coordination action to the durable Sentient worker identity. Model adapters may request `send` and `ack` actions, but they do not supply the sender identity or Lead authority. `DIRECTIVE` and `DECISION` messages require the active Lead lease and matching epoch.

Message IDs are replay-safe: reusing an ID is accepted only when the durable message content and boundaries are identical; conflicting reuse is rejected.

Never ask the human operator to relay a coordination message when an authorized Sentient coordination channel is available. Send it directly; escalate to the human only for decisions requiring human authority.
