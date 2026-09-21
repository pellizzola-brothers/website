using System;
using System.Diagnostics;   // traz o Stopwatch (cronômetro)

namespace CShp_ForcaBruta
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("Teste de Força Bruta");
            Console.Write("\nInforme uma senha  > ");

            // Lê a senha digitada e guarda em Cracker.password
            Cracker.password = Convert.ToString(Console.ReadLine());

            // Converte pra minúsculo, porque o charset do Cracker só tem minúsculas
            Cracker.password = Cracker.password.ToLower();

            Console.WriteLine("\nQuebrando a senha...");

            // Liga o cronômetro
            Stopwatch timer = Stopwatch.StartNew();

            Cracker.tamanhoSenha = Cracker.password.Length; // guarda o tamanho, só pra exibir depois

            // Chama a função que realmente testa as combinações (está no Cracker.cs).
            // Aqui NÃO existe menu de tamanho/charset — ele já usa o que estiver
            // configurado dentro do Cracker (charset fixo).
            Cracker.QuebraSenha(string.Empty);

            timer.Stop(); // desliga o cronômetro

            long elapsedMs = timer.ElapsedMilliseconds;

            // ATENÇÃO: aqui tem uma divisão de inteiro por inteiro (1000, sem ".0"),
            // então o resultado é sempre um número "redondo" (ex: 1500ms vira 1, não 1.5).
            // Isso faz o "else" abaixo quase nunca rodar, exceto quando dá bem menos de 1 segundo.
            double tempoGasto = elapsedMs / 1000;

            if (tempoGasto > 0)
            {
                // Mostra as estatísticas quando o tempo gasto (arredondado) foi maior que 0
                Console.WriteLine("\n\nA senha foi hackeada! Estatísticas:");
                Console.WriteLine("----------------------------------");
                Console.WriteLine("Password: {0}", Cracker.password);
                Console.WriteLine("Tamanho Senha: {0}", Cracker.tamanhoSenha);
                Console.WriteLine("Tentativas: {0}", Cracker.tentativas);

                string plural = "segundos";
                if (tempoGasto == 1)
                {
                    plural = "segundo"; // ajuste de gramática (singular/plural)
                }
                Console.WriteLine("Tempo gasto para hackear a senha: {0} {1}", tempoGasto, plural);
                Console.WriteLine("Senhas por segundo : {0}", (long)(Cracker.tentativas / tempoGasto));
            }
            else
            {
                // Praticamente a mesma coisa do "if" acima, só com texto levemente diferente.
                // Só cai aqui quando a busca foi tão rápida que arredondou pra 0 segundos.
                Console.WriteLine("\n\nA senha foi hackeada ! Estatísticas:");
                Console.WriteLine("----------------------------------");
                Console.WriteLine("Senha: {0}", Cracker.password);
                Console.WriteLine("Tamnho da Senha: {0}", Cracker.tamanhoSenha);
                Console.WriteLine("Tentativas: {0}", Cracker.tentativas);
                Console.WriteLine("Tempo para hackear : {0} segundos", tempoGasto);
            }

            // Segura a tela aberta esperando o usuário apertar uma tecla
            Console.ReadKey();
        }
    }
}
