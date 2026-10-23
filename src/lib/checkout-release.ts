// UI release only. Enabling bulk confirmation requires a separately reviewed
// change after isolated PostgreSQL concurrency/rollback and browser verification.
// Intentionally not controlled by a public/client or deployment environment flag.
export const BULK_DRAFT_CONFIRMATION_ENABLED: boolean = false;
