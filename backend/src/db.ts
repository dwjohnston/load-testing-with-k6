import { Todo } from "./Todo"
import { v4 as uuidv4 } from 'uuid';
import {Client} from 'pg'; 



export type Db = {
    getSingleTodo: (id: string) =>  Promise<Todo |null> ; 
    getAllTodos: () => Promise<Array<Todo>>;
    createTodo: (todo: Omit<Todo, "id">) =>  Promise<Todo>;
}


export async function createInMemoryDb(): Promise<Db> {
    let todos: Todo[] = [];

    return {
        getSingleTodo: async  (id: string) => {
            const todo = todos.find(todo => todo.id === id);
            return todo ?? null;
        },
        getAllTodos: async () => todos,
        createTodo: async (todo: Omit<Todo, 'id'>) => {
            const newTodo: Todo = { id: uuidv4(), ...todo, isComplete: false };
            todos.push(newTodo);
            return newTodo;
        },
    };
}

type PostgresDbOptions = {
    user: string; 
    host: string; 
    database: string; 
    password: string; 
    port: number; 
}

export async function createPostgresDb(options: PostgresDbOptions): Promise<Db> {


    console.log(options.password)

    const client = new Client({...options, });

    await client.connect();

    await client.query(`
        CREATE TABLE IF NOT EXISTS todos (
            id SERIAL PRIMARY KEY,
            description TEXT NOT NULL,
            is_complete BOOLEAN NOT NULL
        );
    `);

    return {
        getSingleTodo: async (id: string) => {
            const result = await client.query('SELECT * FROM todos WHERE id = $1', [id]);
            return result.rows[0] ?? null;
        },
        getAllTodos: async () => {
            const result = await client.query('SELECT * FROM todos');
            return result.rows;
        },
        createTodo: async (todo: Omit<Todo, 'id'>) => {
            const result = await client.query('INSERT INTO todos (description, is_complete) VALUES ($1, $2) RETURNING *', [todo.description, todo.isComplete]);
            return result.rows[0];
        },
    };
}
