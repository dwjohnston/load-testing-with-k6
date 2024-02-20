import { createTodosApp } from "./app";
import { createPostgresDb } from "./db";


const PORT = process.env.PORT || 3000;

async function main() {
    const db = await createPostgresDb({
        user: 'postgres', 
        database: 'postgres', 
        password: 'mysecretpassword', 
        host: 'localhost', 
        port: 5432
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