/** @format */

import { Command } from 'commander';
import axios from 'axios';
import fs from 'fs-extra';
import os from 'os';
import { configSet, storage } from '@serverless-devs-cli/util';
import { CommandManager } from '@serverless-devs-cli/core';
import { version, Parse } from '@serverless-devs-cli/specification';
import { SERVERLESS_COMMAND_DESC_URL, PROCESS_ENV_TEMPLATE_NAME } from '../constants/static-variable';

import i18n from '../utils/i18n';
import logger from '../utils/logger';

const { handlerProfileFile } = configSet;
const { getSubcommand, getServiceConfig } = version;

export function createUniversalCommand(command: string, customerCommandName?: string, description?: string) {
    let params: string[] = [];
    const _command = new Command(command);
    const processArgv: string[] = [];
    let start = false;

    for (let i = 0; i < process.argv.length; i++) {
        if (!start) {
            processArgv.push(process.argv[i]);
        } else {
            params.push(process.argv[i]);
        }
        if (process.argv[i] === command) {
            start = true;
        }
    }

    if (params.length !== 0) {
        process.env.temp_params = params.join(' ');
    } else {
        params = process.env.temp_params ? process.env.temp_params.split(' ') : [];
    }

    process.argv = processArgv;
    _command.description(description || '').action(() => {
        const template: string | undefined = process.env[PROCESS_ENV_TEMPLATE_NAME];
        if (template) {
            const commandManager = new CommandManager(template, command, customerCommandName, params.join(' '));
            commandManager.init();
        }
    });
    return _command;
}


export async function getCommandDetail(name: any, provider: any, version: any): Promise<any[]> {
    let command_list: any = [];
    try {
        const lang = (await handlerProfileFile({ read: true, filePath: 'set-config.yml' })).locale || 'en';
        const result: any = await axios.get(SERVERLESS_COMMAND_DESC_URL + `?lang=${lang}`, {
            params: {
                name,
                provider,
                version,
            },
        });
        if (result.data && result.data.Response) {
            const command = result.data.Response.Command || {};
            command_list = Object.keys(command).map(key => {
                return {
                    name: key,
                    desc: command[key],
                };
            });
        }
    } catch (e) {
        logger.error(e.message);
    }
    return command_list;
}
export async function getParsedTemplateObj(templateFile: any) {
    const parse = new Parse(templateFile);
    const parsedObj = parse.getOriginalParsedObj();
    const result = await parse.getRealVariables(parsedObj);
    return result;
}

export function getCustomerCommandInfo(parsedTemplateObj: any): string[] {

    return getSubcommand(parsedTemplateObj);

}

export async function createCustomerCommand(templateFile: string): Promise<any[]> {
    const customerCommands: any = [];
    const doc = await getParsedTemplateObj(templateFile);
    const commandListPromise = getCustomerCommandInfo(doc).map(async projectName => {
        const projectDocDetail: any = getServiceConfig(doc, projectName);
        const provider = projectDocDetail.Provider || projectDocDetail.provider;
        const component = projectDocDetail.Component || projectDocDetail.component;
        const commandList = await getCommandDetail(component, provider, '');
        return { projectName, commandList, projectDocDetail };
    });
    const commondListDetail = await Promise.all(commandListPromise);
    commondListDetail.forEach(({ projectName, commandList, projectDocDetail }) => {
        const customerCommand = new Command(projectName);
        const provider = projectDocDetail.Provider || projectDocDetail.provider;
        const component = projectDocDetail.Component || projectDocDetail.component;
        const customerCommandDescription = i18n.__("[Custom] The {{component}}@{{provider}} project.", { component, provider })
        customerCommand.description(customerCommandDescription)
        commandList.forEach(async command => {
            const { name: commandName, desc } = command;
            const universialCommandInstance = await createUniversalCommand(commandName, projectName, desc);
            customerCommand.addCommand(universialCommandInstance);
        });
        customerCommands.push(customerCommand);
    });
    return customerCommands;
}

export function registerCommandChecker(program: any) {
    program.on('command:*', (cmds: any) => {
        const commands = program.commands.map((command: any) => command.name());
        if (!commands.includes(cmds[0])) {
            logger.error(`  error: unknown command ${cmds[0]}`);
            program.help();
        }
    });
}

export async function registerExecCommand(system_command: any, templateFile: string) {
    const execCommand = new Command('exec');
    const customerCommandDescription = i18n.__("Subcommand execution analysis");
    execCommand.description(customerCommandDescription);
    execCommand.usage("[subcommand] -- [method] [params]");
    if (templateFile) {
        let commandName = '';
        let projectName = '';
        if (process.argv[3] === '--') {
            commandName = process.argv[4];
            const universialCommandInstance = await createUniversalCommand(commandName, projectName, '');
            execCommand.addCommand(universialCommandInstance);
        }
        if (process.argv[4] === '--' && process.argv[5]) {
            projectName = process.argv[3];
            commandName = process.argv[5];
            const customerCommand = new Command(projectName);
            const universialCommandInstance = await createUniversalCommand(commandName, projectName, '');
            customerCommand.addCommand(universialCommandInstance);
            execCommand.addCommand(customerCommand);
        }
    }
    system_command.addCommand(execCommand);
}

export async function registerCustomerCommand(system_command: any, templateFile: string) {
    if (templateFile) {
        const customerCommands = await createCustomerCommand(templateFile);
        customerCommands.forEach(command => {
            system_command.addCommand(command);
        });
    }
}

export async function registerUniversalCommand(system_command: any, templateFile: string) {
    if (templateFile) {
        const parsedTemplateObj = await getParsedTemplateObj(templateFile);
        const customerCommands = getCustomerCommandInfo(parsedTemplateObj);
        if (process.argv[2] && !customerCommands.includes(process.argv[2]) && !['-h', '--help'].includes(process.argv[2])) {
            system_command.addCommand(createUniversalCommand(process.argv[2]));
        } else if (
            process.argv[2] &&
            customerCommands.includes(process.argv[2]) &&
            process.argv[3] &&
            !customerCommands.includes(process.argv[3])
        ) {
            system_command.addCommand(createUniversalCommand(process.argv[3]));
        }
    }
}

export function registerVerbose(program: any) {
    if (process.argv.includes('--verbose')) {
        process.env.VERBOSE = program.verbose;
    }
}

export function recordCommandHistory(argv: string[]) {
    const file = storage.getHistoryFile();
    fs.appendFileSync(file, argv.join(',') + os.EOL);
}

