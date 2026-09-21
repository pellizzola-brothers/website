using System;                  // biblioteca básica: Console, tipos, conversões etc.
using System.Diagnostics;      // biblioteca que traz o Stopwatch (cronômetro)

namespace CShp_ForcaBruta
{
    class Program
    {
        // Main é o "botão de play" do programa: é a primeira coisa que roda.
        static void Main(string[] args)
        {
            Console.WriteLine("Teste de Força Bruta");
            Console.Write("\nInforme uma senha > ");

            // Lê o que o usuário digitou e guarda na variável password (lá no Cracker.cs)
            Cracker.password = Convert.ToString(Console.ReadLine());

            // Deixa tudo minúsculo, porque o charset só tem letras minúsculas.
            // Se não fizer isso, uma senha com maiúscula nunca seria encontrada.
            Cracker.password = Cracker.password.ToLower();

            // ---------------------------------------------------
            // PASSO 1: perguntar o intervalo de tamanho a testar
            // ---------------------------------------------------
            int tamanhoMin, tamanhoMax;

            Console.Write("\nTamanho mínimo para testar (3 a 6) > ");
            // TryParse tenta converter o texto digitado em número.
            // O laço "while" repete a pergunta até a pessoa digitar um número válido entre 3 e 6.
            while (!int.TryParse(Console.ReadLine(), out tamanhoMin) || tamanhoMin < 3 || tamanhoMin > 6)
            {
                Console.Write("Valor inválido. Digite um número entre 3 e 6 > ");
            }

            Console.Write("Tamanho máximo para testar (3 a 6) > ");
            // O máximo não pode ser menor que o mínimo escolhido acima.
            while (!int.TryParse(Console.ReadLine(), out tamanhoMax) || tamanhoMax < tamanhoMin || tamanhoMax > 6)
            {
                Console.Write($"Valor inválido. Digite um número entre {tamanhoMin} e 6 > ");
            }

            // ---------------------------------------------------
            // PASSO 2: perguntar qual conjunto de caracteres usar
            // ---------------------------------------------------
            Console.WriteLine("\nEscolha o tipo de caracteres:");
            Console.WriteLine("1 - Somente números");
            Console.WriteLine("2 - Números e letras");
            Console.WriteLine("3 - Números, letras e símbolos");
            Console.Write("> ");

            int opcao;
            while (!int.TryParse(Console.ReadLine(), out opcao) || opcao < 1 || opcao > 3)
            {
                Console.Write("Opção inválida. Digite 1, 2 ou 3 > ");
            }

            // "switch" aqui é tipo um monte de "if / else if" resumido:
            // dependendo do número escolhido, guarda o texto de caracteres correspondente.
            Cracker.charset = opcao switch
            {
                1 => "0123456789",
                2 => "0123456789abcdefghijklmnopqrstuvwxyz",
                3 => "0123456789abcdefghijklmnopqrstuvwxyz!@#$%&*",
                _ => "0123456789abcdefghijklmnopqrstuvwxyz" // valor padrão, caso algo dê errado
            };

            Console.WriteLine("\nQuebrando a senha...");

            // Liga o cronômetro pra medir quanto tempo o processo vai levar.
            Stopwatch timer = Stopwatch.StartNew();

            Cracker.tamanhoSenha = Cracker.password.Length; // só guarda o tamanho da senha digitada, pra mostrar depois
            Cracker.encontrada = false;                      // garante que começa "não encontrada"
            Cracker.tentativas = 0;                          // zera o contador de tentativas

            // ---------------------------------------------------
            // PASSO 3: tentar quebrar a senha, tamanho por tamanho
            // ---------------------------------------------------
            // Ex: se o usuário escolheu de 3 a 5, primeiro testa TODAS as combinações de tamanho 3,
            // depois todas de tamanho 4, depois todas de tamanho 5 — até achar ou esgotar tudo.
            for (int tam = tamanhoMin; tam <= tamanhoMax && !Cracker.encontrada; tam++)
            {
                Cracker.tamanhoAlvo = tam;
                Cracker.QuebraSenha(string.Empty); // começa a busca a partir de uma string vazia
            }

            timer.Stop(); // desliga o cronômetro

            long elapsedMs = timer.ElapsedMilliseconds;   // tempo gasto em milissegundos
            double tempoGasto = elapsedMs / 1000.0;       // convertido pra segundos (o ".0" evita divisão de inteiro errada)

            // ---------------------------------------------------
            // PASSO 4: mostrar o resultado na tela
            // ---------------------------------------------------
            if (Cracker.encontrada)
            {
                // Só um ajuste de gramática: "1 segundo" no singular, "2 segundos" no plural
                string plural = (tempoGasto == 1) ? "segundo" : "segundos";

                Console.WriteLine("\n\nA senha foi hackeada! Estatísticas:");
                Console.WriteLine("----------------------------------");
                Console.WriteLine("Password: {0}", Cracker.password);           // {0} é substituído pelo valor depois da vírgula
                Console.WriteLine("Tamanho Senha: {0}", Cracker.tamanhoSenha);
                Console.WriteLine("Tentativas: {0}", Cracker.tentativas);
                Console.WriteLine("Tempo gasto para hackear a senha: {0} {1}", tempoGasto, plural);

                if (tempoGasto > 0)
                    Console.WriteLine("Senhas por segundo : {0}", (long)(Cracker.tentativas / tempoGasto));
            }
            else
            {
                // Só cai aqui se o intervalo de tamanho/charset escolhido não continha a senha
                Console.WriteLine("\n\nNão foi possível quebrar a senha com as opções escolhidas.");
                Console.WriteLine("Tentativas: {0}", Cracker.tentativas);
                Console.WriteLine("Tempo gasto: {0} segundos", tempoGasto);
            }

            // Segura a janela aberta esperando uma tecla, senão ela fecharia sozinha na hora.
            Console.ReadKey();
        }
    }
}
