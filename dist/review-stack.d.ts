/** The wire contract used by the Work View deck, its worker and the hosted adapter. */
export declare const REVIEW_STACK_MODES: readonly ['browse', 'work'];
export type ReviewStackMode = typeof REVIEW_STACK_MODES[number];
export declare const REVIEW_STACK_MODE_LABELS: Record<ReviewStackMode, string>;
export declare const REVIEW_STACK_VERDICTS: readonly ['seen', 'skip'];
export type ReviewStackVerdict = typeof REVIEW_STACK_VERDICTS[number];
export declare const REVIEW_STACK_VERDICT_LABELS: Record<ReviewStackVerdict, string>;
export declare const REVIEW_STACK_ACTIONS: readonly ["seen", "skip", "undo", "bookmark", "follow-up", "set-follow-up", "seen-group", "undo-group"];
export declare const REVIEW_STACK_CARD_KIND = "stack-card";
export declare const REVIEW_STACK_RECORD_KINDS: readonly ["stack-card", 'stack-part', 'stack-event', 'stack-group-part', 'stack-receipt'];
export type ReviewStackRecordKind = typeof REVIEW_STACK_RECORD_KINDS[number];
export declare const isReviewStackKind: (kind: string) => kind is ReviewStackRecordKind;
export declare const REVIEW_STACK_IMPORT_LIMIT = 12;
export declare const REVIEW_STACK_IMAGE_BYTES: number;
export declare const reviewStackFocusKey: (focus: string) => string;
export declare const REVIEW_STACK_CARD_TOOL_SCHEMA: {
    readonly type: 'object';
    readonly required: readonly ['key', 'focus', 'title', 'what', 'context'];
    readonly properties: {
        readonly key: {
            readonly type: 'string';
            readonly description: 'Stable original asset or variant identifier.';
        };
        readonly focus: {
            readonly type: 'string';
            readonly description: 'Project or focus area.';
        };
        readonly title: {
            readonly type: 'string';
            readonly description: 'A 3–5 word title.';
        };
        readonly what: {
            readonly type: 'string';
            readonly description: 'A 10–15 word description of the original.';
        };
        readonly context: {
            readonly type: 'string';
            readonly description: '10–15 words about where the work lives or what it was for.';
        };
        readonly source: {
            readonly type: 'string';
            readonly description: 'Original HTTPS asset, document or conversation link.';
        };
        readonly preview: {
            readonly type: 'string';
            readonly description: 'Durable HTTPS URL of the original image or its preview.';
        };
        readonly imageData: {
            readonly type: 'string';
            readonly description: 'JPEG, PNG or WebP thumbnail data URL, up to 160 KiB decoded.';
        };
        readonly excerpt: {
            readonly type: 'string';
            readonly description: 'An excerpt of the original work.';
        };
    };
    readonly additionalProperties: false;
};
export interface ReviewStackImportCard {
    key: string;
    focus: string;
    title: string;
    what: string;
    context: string;
    source?: string;
    preview?: string;
    imageData?: string;
    excerpt?: string;
}
export interface ReviewStackCard extends ReviewStackImportCard {
    id: string;
    createdAt: number;
    focusId?: string;
}
export interface ReviewStackReview {
    id: string;
    cardId: string;
    action: ReviewStackVerdict;
    createdAt: number;
    groupId?: string;
}
export interface ReviewStackBookmark {
    cardId: string;
    saved: boolean;
    revision: number;
}
export interface ReviewStackFollowUp {
    id: string;
    cardId: string;
    body: string;
    createdAt: number;
    closedAt: number | null;
    revision: number;
}
export interface ReviewStackGroup {
    id: string;
    focus: string;
    focusId?: string;
    createdAt: number;
    count: number;
    activeCount: number;
}
export interface ReviewStackSnapshot {
    revision: string;
    cards: ReviewStackCard[];
    reviews: ReviewStackReview[];
    bookmarks: ReviewStackBookmark[];
    followUps: ReviewStackFollowUp[];
    groups: ReviewStackGroup[];
}
export interface ReviewStackPage extends ReviewStackSnapshot {
    nextCursor: string | null;
}
export type ReviewStackAction = {
    action: ReviewStackVerdict;
    cardId: string;
    expectedReviewId: string | null;
} | {
    action: 'undo';
    cardId: string;
    reviewId: string;
} | {
    action: 'bookmark';
    cardId: string;
    saved: boolean;
    revision: number;
} | {
    action: 'follow-up';
    cardId: string;
    body: string;
} | {
    action: 'set-follow-up';
    cardId: string;
    followUpId: string;
    closed: boolean;
    revision: number;
} | {
    action: 'seen-group';
    focus: string;
    cardId?: string;
} | {
    action: 'undo-group';
    groupId: string;
};
export interface ReviewStackImportResult {
    added: number;
    existing: number;
    firstId: string;
}
export interface ReviewStackActionResult {
    ok: true;
}
export type ReviewStackWriteResult = ReviewStackImportResult | ReviewStackActionResult;
