import express, { Request, Response, Express } from 'express';
import { Db } from './db';


export function createTodosApp(db: Db): Express {

    const app = express();
    app.use(express.json());

    // Health check
    app.get("/ready", (req, res) => {
        res.send(200);
    })

    app.get('/todos', async (req: Request, res: Response) => {

        const todos = await db.getAllTodos();
        res.json(todos);
    });




    app.get('/todos/:id', async (req: Request, res: Response) => {

        const todo = await db.getSingleTodo(req.params.id);
        if (!todo) {
            return res.status(404).json({ message: 'Todo not found' });
        }
        res.json(todo);
    });

    app.post('/todos', async (req: Request, res: Response) => {
        const { description, isComplete } = req.body;

        console.log(description, isComplete)

        // TODO use zod here. 
        if (!description || typeof isComplete !== 'boolean') {
            return res.status(400).json({ message: 'Please provide description, and isComplete fields' });
        }
        const newTodo = db.createTodo({ description, isComplete });
        res.status(201).json(newTodo);
    });

    return app;
}
