import { createTodosApp } from "./app";
import { createPostgresDb } from "./db";
import { EnvVarSecretManager } from "./secrets";
require('dotenv').config()


const PORT = parseInt(process.env.PORT ?? '') || 3000;


const {PG_USER, PG_DATABASE, PG_HOST, PG_PORT} = process.env; 

async function main() {

    if(!PG_USER || !PG_DATABASE ||  !PG_HOST || !PG_PORT) {
        throw new Error("Expected PG_USER, PG_DATABASE, PG_PASSWORD, PG_HOST, PG_PORT env vars to exist");
    }

    const password = await  EnvVarSecretManager.getDbPassword();    

    const db = await createPostgresDb({
        user: PG_USER, 
        database: PG_DATABASE, 
        password,
        host: PG_HOST, 
        port: parseInt(PG_PORT), 
    }); 

    const app = createTodosApp(db); 
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

main().catch((err) => {
    console.error(err); 
    process.exit(1);
})