import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createLogger } from "./logger.js";

/**
 * Configuration loader for prompts and server settings.
 */
export class ConfigurationLoader {
    private readonly logger = createLogger("ConfigurationLoader");
    private readonly baseDir: string;
    private readonly initialInstructions: string;
    private readonly baseInstructions: string;
    private readonly maxUploadBytes: number;

    /**
     * Default maximum decoded image payload accepted by `image_remote_upload`.
     */
    public static readonly DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

    /**
     * Penpot backend's default `media-max-file-size` (30 MiB), used to keep the
     * MCP-side limit from exceeding what the backend accepts by default.
     */
    public static readonly BACKEND_DEFAULT_MAX_MEDIA_BYTES = 30 * 1024 * 1024;

    /**
     * Creates a new configuration loader instance.
     *
     * @param baseDir - Base directory for resolving configuration file paths
     */
    constructor(baseDir: string) {
        this.baseDir = baseDir;
        this.initialInstructions = this.loadFileContent(join(this.baseDir, "data", "initial_instructions.md"));
        this.baseInstructions = this.loadFileContent(join(this.baseDir, "data", "base_instructions.md"));
        this.maxUploadBytes = this.resolveMaxUploadBytes();
    }

    /**
     * Resolves the configured maximum decoded image payload (in bytes) for
     * `image_remote_upload`. Reads `PENPOT_MCP_MAX_UPLOAD_BYTES`, defaulting to
     * {@link DEFAULT_MAX_UPLOAD_BYTES}. Values above the Penpot backend's default
     * media maximum are clamped (with a warning) so the server does not silently
     * advertise an accepted payload that Penpot will outright reject.
     *
     * @returns the effective maximum upload size in bytes
     */
    private resolveMaxUploadBytes(): number {
        const raw = process.env.PENPOT_MCP_MAX_UPLOAD_BYTES;
        let value: number;
        if (raw === undefined || raw.trim() === "") {
            value = ConfigurationLoader.DEFAULT_MAX_UPLOAD_BYTES;
        } else {
            const parsed = parseInt(raw, 10);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                throw new Error(
                    `Invalid PENPOT_MCP_MAX_UPLOAD_BYTES: "${raw}". It must be a positive integer number of bytes.`
                );
            }
            value = parsed;
        }

        if (value > ConfigurationLoader.BACKEND_DEFAULT_MAX_MEDIA_BYTES) {
            this.logger.warn(
                `PENPOT_MCP_MAX_UPLOAD_BYTES=${value} exceeds Penpot's default media maximum ` +
                    `(${ConfigurationLoader.BACKEND_DEFAULT_MAX_MEDIA_BYTES} bytes); clamping to ` +
                    `${ConfigurationLoader.BACKEND_DEFAULT_MAX_MEDIA_BYTES}. If your Penpot backend is configured with a ` +
                    `larger media-max-file-size and you need to accept larger uploads, raise Penpot's media-max-file-size ` +
                    `to match.`
            );
            value = ConfigurationLoader.BACKEND_DEFAULT_MAX_MEDIA_BYTES;
        }

        return value;
    }

    private loadFileContent(filePath: string): string {
        if (!existsSync(filePath)) {
            throw new Error(`Configuration file not found at ${filePath}`);
        }
        return readFileSync(filePath, "utf8");
    }

    /**
     * Gets the initial instructions for the MCP server corresponding to the
     * 'Penpot High-Level Overview'
     *
     * @returns The initial instructions string
     */
    public getInitialInstructions(): string {
        return this.initialInstructions;
    }

    /**
     * Gets the base instructions which shall be provided to clients when connecting to
     * the MCP server
     *
     * @returns The initial instructions string
     */
    public getBaseInstructions(): string {
        return this.baseInstructions;
    }

    /**
     * Gets the maximum decoded image payload (in bytes) accepted by
     * `image_remote_upload`.
     *
     * This is a transport/server limit intended to protect the MCP server and
     * transport. It is not a guarantee that an agent can reliably upload an
     * image of that size: in an LLM-mediated workflow the base64 must first pass
     * through model context, whose practical limit is far smaller.
     *
     * @returns the maximum upload size in bytes
     */
    public getMaxUploadBytes(): number {
        return this.maxUploadBytes;
    }
}
