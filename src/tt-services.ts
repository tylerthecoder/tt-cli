import { TylersThings } from "@tt-services/src";

let service: TylersThings | null = null;

export const getTT = async (): Promise<TylersThings> => {
    if (!service) {
        service = await TylersThings.buildAndConnect();
    }
    return service;
}