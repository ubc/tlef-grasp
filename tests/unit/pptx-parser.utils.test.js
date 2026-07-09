const fs = require('fs').promises;

const mockParse = jest.fn();
const mockDocumentParsingModule = jest.fn(() => ({ parse: mockParse }));

jest.mock('ubc-genai-toolkit-document-parsing', () => ({
  DocumentParsingModule: mockDocumentParsingModule,
}));
jest.mock('../../src/utils/structured-llm', () => ({ generateStructured: jest.fn() }));
jest.mock('../../src/utils/llm-provider', () => ({ getVisionModel: jest.fn(() => 'vision-model') }));

const { generateStructured } = require('../../src/utils/structured-llm');
const { parsePptx } = require('../../src/utils/pptx-parser');

describe('parsePptx', () => {
  beforeEach(() => {
    mockParse.mockReset();
    mockDocumentParsingModule.mockClear();
    generateStructured.mockReset();
  });

  it('passes uploaded PPTX buffers through the document parsing toolkit', async () => {
    mockParse.mockImplementation(async ({ filePath }, outputFormat) => ({
      content: `${outputFormat}:${await fs.readFile(filePath, 'utf8')}`,
      metadata: {
        detectedInputType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
    }));

    const result = await parsePptx(Buffer.from('pptx-bytes'), 'tiny.pptx');

    expect(mockDocumentParsingModule).toHaveBeenCalledWith(
      expect.objectContaining({
        imageConcurrency: 2,
        imageDescriber: expect.any(Function),
      })
    );
    expect(mockParse).toHaveBeenCalledWith(
      { filePath: expect.stringMatching(/tiny\.pptx$/) },
      'text'
    );
    expect(result).toEqual({
      content: 'text:pptx-bytes',
      tokenUsage: 0,
      metadata: {
        detectedInputType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
    });
  });

  it('uses the supplied PowerPoint image prompt template for embedded images', async () => {
    mockParse.mockResolvedValue({ content: 'slides', metadata: {} });
    generateStructured.mockResolvedValue({
      content: '{"description":"Chart description"}',
      usage: { totalTokens: 9 },
    });

    await parsePptx(
      Buffer.from('pptx-bytes'),
      'tiny.pptx',
      'Slide {slideNumber}; image {fileName}'
    );

    const config = mockDocumentParsingModule.mock.calls[0][0];
    await expect(
      config.imageDescriber({
        data: Buffer.from('image-bytes'),
        mimeType: 'image/jpeg',
        slideNumber: 7,
        imageIndex: 0,
        fileName: 'chart.jpg',
      })
    ).resolves.toBe('Chart description');

    expect(generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Slide 7; image chart.jpg',
        images: [
          {
            data: Buffer.from('image-bytes').toString('base64'),
            mimeType: 'image/jpeg',
          },
        ],
        model: 'vision-model',
        schemaName: 'image_description',
      })
    );
  });
});
