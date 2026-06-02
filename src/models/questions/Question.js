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
     * Returns the schema hint for retrying prompt generation.
     */
    static getSchemaHint() {
        throw new Error("getSchemaHint() must be implemented by subclass");
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
