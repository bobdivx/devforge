import { useState } from 'preact/hooks';

export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body items-center text-center">
        <h2 class="card-title">Compteur Preact</h2>
        <p class="text-4xl font-bold my-4">{count}</p>
        <div class="card-actions">
          <button 
            class="btn btn-primary" 
            onClick={() => setCount(count + 1)}
          >
            Incrémenter
          </button>
          <button 
            class="btn btn-secondary" 
            onClick={() => setCount(0)}
          >
            Réinitialiser
          </button>
        </div>
      </div>
    </div>
  );
}
