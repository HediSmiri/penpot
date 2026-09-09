import { z } from "zod";
import { Tool } from "../Tool";
import { TextResponse, ToolResponse } from "../ToolResponse";
import "reflect-metadata";
import { PenpotMcpServer } from "../PenpotMcpServer";
import { ExecuteCodePluginTask } from "../tasks/ExecuteCodePluginTask";

/**
 * Arguments class for RemoteImageUploadTool.
 */
export class RemoteImageUploadArgs {
    static schema = {
        data: z
            .string()
            .min(1, "data cannot be empty")
            .describe("Base64-encoded image data (raw base64, not a data URI)."),
        filename: z
            .string()
            .min(1, "filename cannot be empty")
            .optional()
            .describe("Optional name to assign to the created rectangle shape. Defaults to 'image'."),
        mime_type: z
            .string()
            .min(1, "mime_type cannot be empty")
            .optional()
            .describe(
                "Optional MIME type of the image (e.g. 'image/png'). If omitted, it is inferred from the filename extension. Penpot performs authoritative MIME validation."
            ),
        x: z.number().optional().describe("Optional X coordinate for the rectangle's position (default 0)."),
        y: z.number().optional().describe("Optional Y coordinate for the rectangle's position (default 0)."),
        width: z
            .number()
            .positive("width must be positive")
            .optional()
            .describe(
                "Optional width for the rectangle. If only width is provided, height is calculated to maintain aspect ratio."
            ),
        height: z
            .number()
            .positive("height must be positive")
            .optional()
            .describe(
                "Optional height for the rectangle. If only height is provided, width is calculated to maintain aspect ratio."
            ),
    };

    data!: string;

    filename?: string;

    mime_type?: string;

    x?: number;

    y?: number;

    width?: number;

    height?: number;
}

/**
 * Valid base64 alphabet (no whitespace), with correct padding.
 */
const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Tool for importing an image sent as base64 data over the MCP protocol.
 *
 * Unlike {@link ImportImageTool} (which reads the MCP server's own local file
 * system and is therefore gated to local mode), this tool receives the image
 * data directly from the MCP client and is available in both local and remote
 * modes. It reuses the same Penpot image-upload pipeline
 * (`penpotUtils.importImage` → `penpot.uploadMediaData`); Penpot remains the
 * authoritative validator of the image content.
 */
export class RemoteImageUploadTool extends Tool<RemoteImageUploadArgs> {
    /**
     * Maps file extensions to MIME types, matching the supported types of the
     * existing `import_image` tool (plus SVG).
     */
    protected static readonly MIME_TYPES: Readonly<Record<string, string>> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
    };

    /**
     * MIME type used when neither an explicit `mime_type` nor an inferable
     * filename extension is available. Penpot still validates the real type.
     */
    public static readonly DEFAULT_MIME_TYPE = "image/png";

    /**
     * Creates a new RemoteImageUpload tool instance.
     *
     * @param mcpServer - The MCP server instance
     */
    constructor(mcpServer: PenpotMcpServer) {
        super(mcpServer, RemoteImageUploadArgs.schema);
    }

    public getToolName(): string {
        return "image_remote_upload";
    }

    public getToolDescription(): string {
        return (
            "Imports an image provided as base64 data into Penpot by creating a Rectangle instance " +
            "that uses the image as a fill. Unlike import_image (which reads the MCP server's local file system), " +
            "this tool receives the image data from the MCP client and works in both local and remote modes. " +
            "The rectangle has the image's original proportions by default. Optionally accepts position (x, y) and " +
            "dimensions (width, height) parameters; if only one dimension is provided, the other is calculated to " +
            "maintain the image's aspect ratio. Provide raw base64 (not a data URI). " +
            "Supported formats: JPEG, PNG, GIF, WEBP, SVG. Penpot performs authoritative validation of the image content."
        );
    }

    /**
     * Removes ASCII whitespace (which base64 decoders ignore) from the data.
     *
     * @param data - base64 data
     * @returns the same data without whitespace
     */
    public static stripWhitespace(data: string): string {
        return data.replace(/[\s]/g, "");
    }

    /**
     * Validates the base64 structure of the given (whitespace-stripped) data.
     *
     * This is a structural transport check only; Penpot remains the
     * authoritative validator of the image contents and MIME type.
     *
     * @param data - whitespace-stripped base64 data
     * @throws Error if the data is not well-formed base64
     */
    public static validateBase64(data: string): void {
        if (data.length === 0) {
            throw new Error("Invalid base64 image data: the data is empty.");
        }
        if (!BASE64_REGEX.test(data)) {
            throw new Error(
                "Invalid base64 image data: expected a base64-encoded image (no data URI). Provide raw base64 such as 'iVBORw0KGgo...'."
            );
        }
    }

    /**
     * Returns the decoded byte count implied by the length of a
     * whitespace-stripped base64 string, without decoding the data.
     *
     * @param base64 - whitespace-stripped base64 data
     * @returns the number of decoded bytes
     */
    public static base64DecodedLength(base64: string): number {
        let padding = 0;
        if (base64.length >= 1 && base64.endsWith("=")) {
            padding++;
        }
        if (base64.length >= 2 && base64.endsWith("==")) {
            padding++;
        }
        return Math.floor(base64.length / 4) * 3 - padding;
    }

    /**
     * Enforces the configured decoded-byte size limit for the given (normalized)
     * base64 data, without decoding it.
     *
     * @param base64 - whitespace-stripped base64 data
     * @param maxBytes - the maximum allowed decoded size in bytes
     * @returns the number of decoded bytes
     * @throws Error if the decoded size exceeds the limit
     */
    public static assertWithinSizeLimit(base64: string, maxBytes: number): number {
        const decodedBytes = RemoteImageUploadTool.base64DecodedLength(base64);
        if (decodedBytes > maxBytes) {
            throw new Error(
                `Image data decodes to ${decodedBytes} bytes, which exceeds the maximum configured upload size of ${maxBytes} bytes.`
            );
        }
        return decodedBytes;
    }

    /**
     * Rejects data URIs and returns the normalized (whitespace-stripped,
     * structurally valid) base64 data.
     *
     * @param data - the raw base64 data from the tool arguments
     * @returns the normalized base64 data
     * @throws Error if a data URI is supplied or the base64 is malformed
     */
    public static normalizeBase64(data: string): string {
        if (/^data:/i.test(data.trim())) {
            throw new Error(
                "Invalid image data: a data URI was provided. Provide raw base64 image data (without the 'data:...;base64,' prefix)."
            );
        }
        const stripped = RemoteImageUploadTool.stripWhitespace(data);
        RemoteImageUploadTool.validateBase64(stripped);
        return stripped;
    }

    /**
     * Resolves the MIME type for the upload.
     *
     * An explicit `mimeType` is passed through unchanged. Otherwise the type is
     * inferred from the filename extension; when there is no inferable extension,
     * a sensible default is used. No content-based verification is performed here —
     * Penpot validates the actual image authoritatively.
     *
     * @param filename - the filename to infer the MIME type from
     * @param mimeType - an optional explicit MIME type
     * @returns the resolved MIME type
     */
    public static resolveMimeType(filename: string, mimeType?: string): string {
        if (mimeType) {
            return mimeType;
        }
        const dot = filename.lastIndexOf(".");
        if (dot >= 0 && dot < filename.length - 1) {
            const ext = filename.slice(dot).toLowerCase();
            const inferred = RemoteImageUploadTool.MIME_TYPES[ext];
            if (inferred) {
                return inferred;
            }
        }
        return RemoteImageUploadTool.DEFAULT_MIME_TYPE;
    }

    /**
     * Builds the plugin JavaScript that imports the image into Penpot.
     *
     * All user-controlled strings are embedded via {@link JSON.stringify} so the
     * generated code cannot be broken out of or injected into. Numbers are
     * validated by the schema and emitted as literals (`undefined` for omitted
     * dimensions), so they cannot carry injected code.
     *
     * @param base64 - the normalized base64 image data
     * @param mimeType - the resolved MIME type
     * @param filename - the resolved filename
     * @param x - the x position (defaults to 0)
     * @param y - the y position (defaults to 0)
     * @param width - optional width
     * @param height - optional height
     * @returns the JavaScript code to execute in the plugin
     */
    public static buildImportCode(
        base64: string,
        mimeType: string,
        filename: string,
        x: number | undefined,
        y: number | undefined,
        width: number | undefined,
        height: number | undefined
    ): string {
        const safeBase64 = JSON.stringify(base64);
        const safeMimeType = JSON.stringify(mimeType);
        const safeFilename = JSON.stringify(filename);

        const posX = x ?? 0;
        const posY = y ?? 0;
        const widthArg = width ?? "undefined";
        const heightArg = height ?? "undefined";

        return `
            const rectangle = await penpotUtils.importImage(
                ${safeBase64}, ${safeMimeType}, ${safeFilename},
                ${posX}, ${posY},
                ${widthArg}, ${heightArg});
            return { id: rectangle.id, name: rectangle.name, width: rectangle.width, height: rectangle.height };
            `;
    }

    protected async executeCore(args: RemoteImageUploadArgs): Promise<ToolResponse> {
        // normalize (whitespace-strip + structural validation) the base64 data
        const base64 = RemoteImageUploadTool.normalizeBase64(args.data);

        // enforce the configured decoded-byte size limit, protecting the server/transport
        RemoteImageUploadTool.assertWithinSizeLimit(base64, this.mcpServer.configLoader.getMaxUploadBytes());

        const filename = args.filename ?? "image";
        const mimeType = RemoteImageUploadTool.resolveMimeType(filename, args.mime_type);

        const code = RemoteImageUploadTool.buildImportCode(
            base64,
            mimeType,
            filename,
            args.x,
            args.y,
            args.width,
            args.height
        );

        const task = new ExecuteCodePluginTask({ code: code });
        const executionResult = await this.mcpServer.pluginBridge.executePluginTask(task);

        return new TextResponse(JSON.stringify(executionResult.data?.result, null, 2));
    }
}
