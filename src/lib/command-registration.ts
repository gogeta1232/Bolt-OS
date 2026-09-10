import { container } from '@sapphire/pieces';

/**
 * Enhanced command registration utilities with better error handling
 */
export class CommandRegistrationHelper {
  /**
   * Check for potential registration issues and provide recommendations
   */
  public static async checkRegistrationHealth(): Promise<string[]> {
    const issues: string[] = [];

    try {
      const commandStore = container.client.stores.get('commands');
      const commandNames = new Set<string>();
      const duplicateNames: string[] = [];

      // Check for duplicate command names
      for (const command of commandStore.values()) {
        if (commandNames.has(command.name)) {
          duplicateNames.push(command.name);
        } else {
          commandNames.add(command.name);
        }
      }

      if (duplicateNames.length > 0) {
        issues.push(`Duplicate command names found: ${duplicateNames.join(', ')}`);
      }

      // Check perm command complexity
      const permCommand = commandStore.get('perm');
      if (permCommand) {
        issues.push('Perm command has complex subcommand structure - may cause registration issues');
      }

      // Log current command count
      issues.push(`Total commands loaded: ${commandStore.size}`);
    } catch (error) {
      container.logger.error({ err: error }, 'Failed to check command registration health');
      issues.push('Failed to analyze command structure');
    }

    return issues;
  }

  /**
   * Force a complete command re-registration by clearing all global commands
   */
  public static async forceClearGlobalCommands(): Promise<void> {
    try {
      container.logger.info('Clearing all global commands to force re-registration...');

      const application = await container.client.application?.fetch();
      if (application) {
        await application.commands.set([]);
        container.logger.info('Successfully cleared all global commands');
      }
    } catch (error) {
      container.logger.error({ err: error }, 'Failed to clear global commands');
    }
  }
}
