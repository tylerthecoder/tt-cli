import { agent } from '@tt-services/src/agent/agent';
import { run, RunResult, RunState, RunToolApprovalItem } from '@openai/agents';
import inquirer from 'inquirer';


export const runAgent = async () => {
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
                const json = toolApprovalItem.toJSON();

                console.log("The agent wants to run the following tool: ", json);

                const answer = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'confirm',
                        message: `Do you approve of the agent running the following tool? ${json}`,
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