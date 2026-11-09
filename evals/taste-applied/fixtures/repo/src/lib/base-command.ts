export abstract class BaseCommand {
  abstract readonly name: string;

  abstract execute(args: string[]): string;
}
