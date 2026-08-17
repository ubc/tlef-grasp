// Four concurrent objectives issue roughly 16 provider calls plus ~20
// retrieval embeddings. Anything left outside the limiter relocates the 429s
// instead of preventing them, so both paths are asserted.
const mockRun = jest.fn((fn) => fn());

jest.mock('../../src/utils/generation-limiter', () => ({
  generationLimiter: { run: mockRun },
}));

const { retrieveForSource } = require('../../src/services/rag-fanout');

describe('retrieval runs under the generation limiter', () => {
  beforeEach(() => mockRun.mockClear());

  it('wraps the first search', async () => {
    const instance = { retrieveContext: jest.fn().mockResolvedValue([{ content: 'a' }]) };

    await retrieveForSource(instance, 'source-1', 'query', 50, 0.6);

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(instance.retrieveContext).toHaveBeenCalledTimes(1);
  });

  it('wraps the no-threshold retry too', async () => {
    const instance = {
      retrieveContext: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ content: 'b' }]),
    };

    await retrieveForSource(instance, 'source-1', 'query', 50, 0.6);

    // Both the thresholded search and its retry are capped.
    expect(mockRun).toHaveBeenCalledTimes(2);
  });
});
