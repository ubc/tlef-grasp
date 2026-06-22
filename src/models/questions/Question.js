class Question {
    constructor(data) {
        this.data = data;
    }

    /**
     * Returns the prompt instructions specific to this question type.
     */
    static getPromptInstruction() {
        throw new Error("getPromptInstruction() must be implemented by subclass");
    }

    /**
     * Returns the JSON schema the generated question must conform to (used for
     * constrained decoding). Shape is enforced here; semantics by
     * validateAndNormalize.
     */
    static getJsonSchema() {
        throw new Error("getJsonSchema() must be implemented by subclass");
    }

    /**
     * Returns the retry suffix added to the prompt when LLM output is malformed.
     */
    static getRetrySuffix(attempt, lastError) {
        throw new Error("getRetrySuffix() must be implemented by subclass");
    }

    /**
     * Validates and normalizes the parsed JSON output from the LLM.
     * Throws an error if invalid.
     */
    static validateAndNormalize(data) {
        throw new Error("validateAndNormalize() must be implemented by subclass");
    }
}

module.exports = Question;
