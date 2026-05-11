export class SkillsManagerError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'SkillsManagerError'
  }
}

export class AgentNotSupportedError extends SkillsManagerError {
  override name = 'AgentNotSupportedError'
}
export class SkillNotFoundError extends SkillsManagerError {
  override name = 'SkillNotFoundError'
}
export class SourceParseError extends SkillsManagerError {
  override name = 'SourceParseError'
}
export class ForeignPathError extends SkillsManagerError {
  override name = 'ForeignPathError'
}
