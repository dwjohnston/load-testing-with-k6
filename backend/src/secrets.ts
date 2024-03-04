export type SecretManager = {
    getDbPassword: () => Promise<string>; 
} 


export const EnvVarSecretManager : SecretManager = {
    getDbPassword: async () => {

        const pw = process.env.PG_PASSWORD; 
        if (!pw){
            throw new Error("Expect process.env.PG_PASSWORD to exist");
        }

        return pw; 
    }
}

// Todo implement Aws EnvVar secret manager. 

