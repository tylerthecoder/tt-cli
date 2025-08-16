import { run, RunResult, RunState, RunToolApprovalItem } from '@openai/agents';
import inquirer from 'inquirer';
import { getTT } from './utils.ts';
import { makeAgent } from '@tt-services/src/agent/agent';


const renderToolCall = async (toolCall: RunToolApprovalItem) => {
    const json = toolCall.toJSON();
    const toolCallName: string = json.rawItem && "name" in json.rawItem ? json.rawItem.name : "";
    const toolCallArguments: Record<string, any> = json.rawItem && "arguments" in json.rawItem && json.rawItem.arguments ? JSON.parse(json.rawItem.arguments) : {};

    let displayData = `${toolCallName} with parameters:\n`;

    for (const [key, value] of Object.entries(toolCallArguments)) {
        const isNoteId = key === "noteId";

        if (isNoteId) {
            const tt = await getTT();
            const noteMetadata = await tt.notes.getNoteMetadataById(value);

            displayData += `  Note:
    - Passed ID: ${value}
    - Title: ${noteMetadata?.title}
    - Date: ${noteMetadata?.date}
    - Tags: ${noteMetadata?.tags?.join(", ")}\n`;

            continue;
        }

        displayData += `  ${key}: ${value}\n`;
    }

    return displayData;
};


export async function runAgent() {
    const tt = await getTT();
    const agent = await makeAgent(tt);
    const prompt = await inquirer.prompt([
        {
            type: 'input',
            name: 'prompt',
            message: 'What do you want the agent to do?',
        },
    ]);

    let result: RunResult<any, any> = await run(agent, prompt.prompt);

    while (true) {
        let hasInterruptions = result.interruptions.length > 0;

        console.log("Has interruptions: ", hasInterruptions);

        if (!hasInterruptions) {
            console.log(result.finalOutput);
            const answer = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: `Do you want to stop the agent?`,
                },
            ]);

            if (answer.confirm) {
                return;
            }

            const newPrompt = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'prompt',
                    message: 'What do you want the agent to do?',
                },
            ]);
            const actions = result.history.map((h) => JSON.stringify(h)).join('\n');

            const fullIntructions = `
            Past conversation:
            ${result.finalOutput}

            Past actions:
            ${actions}

            New instructions:
            ${newPrompt.prompt}
            `;

            result = await run(agent, fullIntructions);

            continue;
        } else {
            const runState = result.state;
            for (const interruption of result.interruptions) {
                if (interruption.type !== 'tool_approval_item') {
                    console.log("Got non-tool interruption", interruption);
                    continue;
                }

                const toolApprovalItem = interruption as RunToolApprovalItem;

                const toolCallDisplay = await renderToolCall(toolApprovalItem);

                const answer = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'confirm',
                        message: `Do you approve of the agent running the following tool?\n${toolCallDisplay}`,
                    },
                ]);

                if (answer.confirm) {
                    runState.approve(toolApprovalItem);
                } else {
                    runState.reject(toolApprovalItem);
                }
            }

            result = await run(agent, runState);
        }
    }
};