export class PingCommand {
  readonly name = "ping";

  run(): string {
    return "pong";
  }
}
